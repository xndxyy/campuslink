import { randomBytes, randomUUID } from 'node:crypto';

import { expect, test } from '../helpers/playwright-e2e';
import { hash } from 'bcryptjs';
import { Pool } from 'pg';

import { assertSafeDestructiveE2eEnvironment } from '../helpers/e2e-database-safety';
import { shouldRunSharedAccountE2e } from '../helpers/e2e-environment';

const run = shouldRunSharedAccountE2e(process.env);
if (run) assertSafeDestructiveE2eEnvironment(process.env);
test.skip(!run, 'Requires isolated live PostgreSQL and complete E2E services.');

async function fixture() {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const runId = randomUUID();
  const campus = await db.query<{ campusId: string }>(
    `SELECT "campusId" FROM "User" WHERE email = $1`,
    [process.env.E2E_VERIFIED_EMAIL],
  );
  const campusId = campus.rows[0]?.campusId;
  if (!campusId) throw new Error('E2E campus unavailable.');
  const category = await db.query<{ slug: string }>(
    `SELECT slug FROM "ForumCategory" WHERE "campusId"=$1 AND "isActive"=true ORDER BY label,id LIMIT 1`,
    [campusId],
  );
  if (!category.rows[0]) throw new Error('E2E forum category unavailable.');
  const users = await Promise.all(
    ['owner', 'reporter'].map(async (role) => {
      const id = `e2e-tree-${role}-${runId}`;
      const email = `${id}@campuslink.test`;
      const password = randomBytes(24).toString('base64url');
      await db.query(
        `INSERT INTO "User" (id, "campusId", name, email, "passwordHash", role, status, "emailVerifiedAt", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,'STUDENT','ACTIVE',now(),now(),now())`,
        [id, campusId, `树洞${role}`, email, await hash(password, 12)],
      );
      return { email, id, password };
    }),
  );
  return { category: category.rows[0].slug, db, runId, users };
}

async function signIn(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
) {
  await page.goto('/auth/sign-in');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).not.toHaveURL(/auth\/sign-in/);
}

async function cleanup(value: Awaited<ReturnType<typeof fixture>>) {
  const ids = value.users.map((user) => user.id);
  const posts = await value.db.query<{ id: string }>(
    `SELECT id FROM "ForumPost" WHERE title LIKE $1`,
    [`%${value.runId}%`],
  );
  const postIds = posts.rows.map((post) => post.id);
  await value.db.query(
    `DELETE FROM "Report" WHERE "reporterId" = ANY($1::text[]) OR ("targetType"='FORUM_POST' AND "targetId" = ANY($2::text[]))`,
    [ids, postIds],
  );
  await value.db.query(
    `DELETE FROM "ForumLike" WHERE "postId" = ANY($1::text[])`,
    [postIds],
  );
  await value.db.query(
    `DELETE FROM "ForumComment" WHERE "postId" = ANY($1::text[])`,
    [postIds],
  );
  await value.db.query(`DELETE FROM "ForumPost" WHERE id = ANY($1::text[])`, [
    postIds,
  ]);
  await value.db.query(
    `DELETE FROM "Session" WHERE "userId" = ANY($1::text[])`,
    [ids],
  );
  await value.db.query(`DELETE FROM "User" WHERE id = ANY($1::text[])`, [ids]);
  await value.db.end();
}

test('anonymous and unverified visitors cannot discover tree-hole pages', async ({
  page,
}) => {
  await page.goto('/forum?view=tree-hole');
  await expect(page).toHaveURL(/auth\/sign-in/);
  const anonymous = await page.request.get('/api/forum/posts?view=tree-hole');
  expect(anonymous.status()).toBe(401);
  await page
    .locator('input[name="email"]')
    .fill(process.env.E2E_UNVERIFIED_EMAIL!);
  await page
    .locator('input[name="password"]')
    .fill(process.env.E2E_UNVERIFIED_PASSWORD!);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(/auth\/sign-in\?error=/);
  const unverified = await page.request.get('/api/forum/posts?view=tree-hole');
  expect(unverified.status()).toBe(401);
});

test('verified users publish and manage a private tree-hole surface without comments or identity leaks', async ({
  page,
}) => {
  const value = await fixture();
  const title = `E2E 匿名树洞 ${value.runId}`;
  const commentRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/comments'))
      commentRequests.push(request.url());
  });
  try {
    await signIn(page, value.users[0]!.email, value.users[0]!.password);
    await page.goto('/forum?view=tree-hole');
    await page
      .getByRole('banner')
      .getByRole('link', { name: '发布内容', exact: true })
      .click();
    await expect(page).toHaveURL(/\/submit\/resource$/);
    await page.getByRole('link', { name: '匿名树洞' }).click();
    await expect(page).toHaveURL(/\/submit\/tree-hole$/);
    await page.locator('input[name="title"]').fill(title);
    await page.locator('select[name="category"]').selectOption(value.category);
    await page
      .locator('textarea[name="body"]')
      .fill('这是一条用于端到端验证的匿名树洞正文。');
    await page.getByRole('button', { name: '发布树洞' }).click();
    await expect(page).toHaveURL(/\/forum\/[^?]+\?view=tree-hole&owner=true/);
    await expect(page.getByRole('button', { name: /评论/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '举报' })).toHaveCount(0);
    await page
      .locator('.forum-owner-editor input[name="title"]')
      .fill(`${title} 已修改`);
    await page.getByRole('button', { name: '保存修改' }).click();
    await expect(page.getByText('发布成功，内容已公开。')).toBeVisible();
    await expect(page.locator('.forum-detail header')).toContainText('已发布');
    await expect(page.locator('.forum-detail header')).not.toContainText(
      'PUBLISHED',
    );

    const row = await value.db.query<{ id: string }>(
      `SELECT id FROM "ForumPost" WHERE "anonymousFingerprint" IS NOT NULL AND title=$1`,
      [`${title} 已修改`],
    );
    const id = row.rows[0]?.id;
    if (!id) throw new Error('Run-scoped tree-hole unavailable.');
    await page.getByRole('button', { name: /^点赞/ }).click();
    await expect(page.getByText('已点赞。', { exact: true })).toBeVisible();
    const likes = await value.db.query<{ postId: string; userId: string }>(
      `SELECT "postId", "userId" FROM "ForumLike" WHERE "postId"=$1 AND "userId"=$2`,
      [id, value.users[0]!.id],
    );
    expect(likes.rows).toEqual([{ postId: id, userId: value.users[0]!.id }]);
    const origin = new URL(page.url()).origin;
    const knownTreeComment = await page.request.post(
      `/api/forum/posts/${id}/comments`,
      {
        data: { body: '不应允许发布的树洞评论。' },
        headers: { Origin: origin },
      },
    );
    const unknownComment = await page.request.post(
      `/api/forum/posts/missing_${value.runId}/comments`,
      {
        data: { body: '不应允许发布的未知评论。' },
        headers: { Origin: origin },
      },
    );
    expect(knownTreeComment.status()).toBe(404);
    expect(unknownComment.status()).toBe(404);
    expect(await knownTreeComment.json()).toEqual(await unknownComment.json());
    const ownerHtml = await page.content();
    const ownerApi = await page.request.get(
      `/api/forum/posts/${id}?view=tree-hole&owner=true`,
    );
    expect(ownerApi.status()).toBe(200);

    await page.context().clearCookies();
    await signIn(page, value.users[1]!.email, value.users[1]!.password);
    await page.goto(`/forum/${id}?view=tree-hole`);
    await expect(page.getByRole('button', { name: /评论/ })).toHaveCount(0);
    await page.getByRole('button', { name: '举报' }).click();
    await page.locator('select[name="reason"]').selectOption('OTHER');
    await page.getByRole('button', { name: '提交举报' }).click();
    await expect(page.getByText('举报已提交。')).toBeVisible();
    const publicHtml = await page.content();
    const publicApi = await page.request.get(
      `/api/forum/posts/${id}?view=tree-hole`,
    );
    expect(publicApi.status()).toBe(200);
    const serialized = `${ownerHtml}${await ownerApi.text()}${publicHtml}${await publicApi.text()}`;
    const serializedLower = serialized.toLowerCase();
    for (const secret of [
      value.users[0]!.id.toLowerCase(),
      'authorid',
      'anonymousciphertext',
      'anonymousfingerprint',
      'anonymouskeyversion',
      'ciphertext',
      'fingerprint',
      'envelope',
      'keyversion',
    ]) {
      expect(serializedLower).not.toContain(secret);
    }
    expect(commentRequests).toEqual([]);
  } finally {
    await cleanup(value);
  }
});
