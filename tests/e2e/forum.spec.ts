import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
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
  const users = await Promise.all(
    ['owner', 'reporter'].map(async (role) => {
      const id = `e2e-forum-${role}-${runId}`;
      const email = `${id}@campuslink.test`;
      const password = randomBytes(24).toString('base64url');
      await db.query(
        `INSERT INTO "User" (id, "campusId", name, email, "passwordHash", role, status, "emailVerifiedAt", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,'STUDENT','ACTIVE',now(),now(),now())`,
        [id, campusId, `论坛${role}`, email, await hash(password, 12)],
      );
      return { email, id, password };
    }),
  );
  return { db, runId, users };
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
    `SELECT id FROM "ForumPost" WHERE "authorId" = ANY($1::text[]) AND title LIKE $2`,
    [ids, `%${value.runId}%`],
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

test('discussion publish, comment, like and report use the real product flow', async ({
  page,
}) => {
  const value = await fixture();
  const title = `E2E 论坛讨论 ${value.runId}`;
  try {
    await signIn(page, value.users[0]!.email, value.users[0]!.password);
    await page.goto('/submit/forum');
    await page.locator('input[name="title"]').fill(title);
    await page.locator('select[name="category"]').selectOption({ index: 1 });
    await page
      .locator('textarea[name="body"]')
      .fill('这是一条用于端到端验证的校园论坛讨论正文。');
    await page.getByRole('button', { name: '发布讨论' }).click();
    await expect(page).toHaveURL(/\/forum\/[^?]+\?view=discussion&owner=true/);
    await page.getByLabel('发表评论').fill('这是一条端到端评论。');
    await page.getByRole('button', { name: '发表评论' }).click();
    await expect(page.getByText('这是一条端到端评论。')).toBeVisible();
    const row = await value.db.query<{ id: string }>(
      `SELECT id FROM "ForumPost" WHERE "authorId"=$1 AND title=$2`,
      [value.users[0]!.id, title],
    );
    const id = row.rows[0]?.id;
    if (!id) throw new Error('Run-scoped forum post unavailable.');
    await page.getByRole('button', { name: '点赞' }).click();
    await expect(page.getByText('已点赞。', { exact: true })).toBeVisible();
    const likes = await value.db.query<{ postId: string; userId: string }>(
      `SELECT "postId", "userId" FROM "ForumLike" WHERE "postId"=$1 AND "userId"=$2`,
      [id, value.users[0]!.id],
    );
    expect(likes.rows).toEqual([{ postId: id, userId: value.users[0]!.id }]);
    await page.reload();
    const likedButton = page.getByRole('button', { name: /^取消点赞/ });
    await expect(likedButton).toBeVisible();
    await expect(likedButton).toHaveAttribute('aria-pressed', 'true');

    await page.context().clearCookies();
    await signIn(page, value.users[1]!.email, value.users[1]!.password);
    await page.goto(`/forum/${id}?view=discussion`);
    await page.getByRole('button', { name: '举报' }).click();
    await page.locator('select[name="reason"]').selectOption('OTHER');
    await page.getByRole('button', { name: '提交举报' }).click();
    await expect(page.getByText('举报已提交。')).toBeVisible();
  } finally {
    await cleanup(value);
  }
});

test.afterEach(async ({ page }) => {
  const cookie = (await page.context().cookies()).find((item) =>
    item.name.includes('campuslink'),
  );
  if (!cookie) return;
  const token = createHash('sha256').update(cookie.value).digest('hex');
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  await db.query(`DELETE FROM "Session" WHERE "sessionTokenHash"=$1`, [token]);
  await db.end();
});
