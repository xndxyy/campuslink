import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { expect, test, type Page } from '../helpers/playwright-e2e';
import { hash } from 'bcryptjs';
import { Pool } from 'pg';

import {
  blockedWordDefaults,
  presetTagDefaults,
} from '../../prisma/default-content-data';
import { assertSafeDestructiveE2eEnvironment } from '../helpers/e2e-database-safety';
import { shouldRunPublishingGovernanceE2e } from '../helpers/e2e-environment';

const runE2e = shouldRunPublishingGovernanceE2e(process.env);
if (runE2e) assertSafeDestructiveE2eEnvironment(process.env);

test.skip(
  !runE2e,
  '需要隔离的 E2E 数据库，以及 AI 管理设置所需的安全环境变量。',
);

const runId = randomUUID();
const campusId = `e2e-publishing-campus-${runId}`;
const studentId = `e2e-publishing-student-${runId}`;
const adminId = `e2e-publishing-admin-${runId}`;
const aiConfigId = `e2e-publishing-ai-${runId}`;
const studentEmail = `publisher-${runId}@campuslink.test`;
const adminEmail = `governance-${runId}@campuslink.test`;
const studentPassword = randomBytes(32).toString('base64url');
const adminPassword = randomBytes(32).toString('base64url');
const tagIds = presetTagDefaults.map(
  (_tag, index) => `e2e-publishing-tag-${index}-${runId}`,
);
const blockedWordIds = blockedWordDefaults.map(
  (_word, index) => `e2e-publishing-word-${index}-${runId}`,
);
let db: Pool;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for governance E2E.`);
  return value;
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/auth/sign-in');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).not.toHaveURL(/auth\/sign-in/);
}

async function expectFooterAtViewportBottom(page: Page) {
  const layout = await page.evaluate(() => {
    const footer = document.querySelector('footer');
    const main = document.querySelector('#main-content');
    if (!footer || !main) throw new Error('Shared layout is missing.');
    const footerBox = footer.getBoundingClientRect();
    const mainBox = main.getBoundingClientRect();
    return {
      footerBottom: footerBox.bottom,
      footerTop: footerBox.top,
      mainBottom: mainBox.bottom,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(layout.footerBottom).toBeGreaterThanOrEqual(layout.viewportHeight - 1);
  expect(layout.footerTop).toBeGreaterThanOrEqual(layout.mainBottom - 1);
  expect(layout.overflow).toBeLessThanOrEqual(1);
}

async function expectStudentSessionActive(page: Page) {
  const sessionCookie = (await page.context().cookies()).find(
    (cookie) =>
      cookie.name === 'campuslink-dev-session' ||
      cookie.name === '__Host-campuslink-session',
  );
  if (!sessionCookie)
    throw new Error('The student session cookie was not set.');
  const sessionTokenHash = createHash('sha256')
    .update(sessionCookie.value)
    .digest('hex');
  await expect
    .poll(async () => {
      const result = await db.query<{
        active: boolean;
        future: boolean;
        total: number;
        verified: boolean;
      }>(
        `SELECT
           bool_and("User".status = 'ACTIVE') AS active,
           bool_and("Session".expires > now()) AS future,
           count(*)::int AS total,
           bool_and("User"."emailVerifiedAt" IS NOT NULL) AS verified
         FROM "Session"
         JOIN "User" ON "User".id = "Session"."userId"
         WHERE "Session"."sessionTokenHash" = $1
           AND "Session"."userId" = $2`,
        [sessionTokenHash, studentId],
      );
      return result.rows[0];
    })
    .toEqual({ active: true, future: true, total: 1, verified: true });
}

test.beforeAll(async () => {
  db = new Pool({ connectionString: required('DATABASE_URL') });
  const [studentHash, adminHash] = await Promise.all([
    hash(studentPassword, 12),
    hash(adminPassword, 12),
  ]);
  await db.query('BEGIN');
  try {
    await db.query(
      `INSERT INTO "Campus"
        (id, slug, name, "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, true, now(), now())`,
      [campusId, `e2e-publishing-${runId}`, `发布治理 E2E ${runId}`],
    );
    await db.query(
      `INSERT INTO "User"
        (id, "campusId", name, email, "passwordHash", role, status,
         "emailVerifiedAt", "createdAt", "updatedAt")
       VALUES
        ($1, $3, '发布测试用户', $4, $5, 'STUDENT', 'ACTIVE', now(), now(), now()),
        ($2, $3, '治理测试管理员', $6, $7, 'ADMIN', 'ACTIVE', now(), now(), now())`,
      [
        studentId,
        adminId,
        campusId,
        studentEmail,
        studentHash,
        adminEmail,
        adminHash,
      ],
    );
    for (const [index, preset] of presetTagDefaults.entries()) {
      await db.query(
        `INSERT INTO "TagDefinition"
          (id, "campusId", scope, label, slug, "isPreset", "isActive", "createdAt")
         VALUES ($1, $2, $3::"TagScope", $4, $5, true, true, now())`,
        [tagIds[index], campusId, preset.scope, preset.label, preset.slug],
      );
    }
    for (const [index, word] of blockedWordDefaults.entries()) {
      await db.query(
        `INSERT INTO "BlockedWord"
          (id, "campusId", original, normalized, category, reason, enabled,
           "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, true, now(), now())`,
        [
          blockedWordIds[index],
          campusId,
          word.original,
          word.normalized,
          word.category,
          word.reason,
        ],
      );
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
});

test.afterAll(async () => {
  if (!db) return;
  await db.query(`DELETE FROM "AuditLog" WHERE "campusId" = $1`, [campusId]);
  await db.query(`DELETE FROM "ContentAssessment" WHERE "campusId" = $1`, [
    campusId,
  ]);
  await db.query(
    `DELETE FROM "ResourceTag" WHERE "resourceId" IN
      (SELECT id FROM "Resource" WHERE "campusId" = $1)`,
    [campusId],
  );
  await db.query(`DELETE FROM "Resource" WHERE "campusId" = $1`, [campusId]);
  await db.query(`DELETE FROM "AiModerationConfig" WHERE id = $1`, [
    aiConfigId,
  ]);
  await db.query(`DELETE FROM "BlockedWord" WHERE id = ANY($1::text[])`, [
    blockedWordIds,
  ]);
  await db.query(`DELETE FROM "TagDefinition" WHERE id = ANY($1::text[])`, [
    tagIds,
  ]);
  await db.query(`DELETE FROM "Session" WHERE "userId" = ANY($1::text[])`, [
    [studentId, adminId],
  ]);
  await db.query(`DELETE FROM "User" WHERE id = ANY($1::text[])`, [
    [studentId, adminId],
  ]);
  await db.query(`DELETE FROM "Campus" WHERE id = $1`, [campusId]);
  await db.end();
});

test('验证中文发布、删除、治理开关和响应式首页', async ({ page }) => {
  const resourceTitle = `文本学习资源 ${runId}`;
  await page.setViewportSize({ height: 900, width: 1440 });
  await signIn(page, studentEmail, studentPassword);
  await expectStudentSessionActive(page);

  await page.goto('/submit/resource');
  const tabs = page.getByRole('navigation', { name: '发布分类' });
  const form = page.locator('form.submission-form');
  await expect(tabs).toBeVisible();
  await expect(form).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const navigation = document.querySelector('nav[aria-label="发布分类"]');
        const submission = document.querySelector('form.submission-form');
        if (!navigation || !submission) return false;
        return Boolean(
          navigation.compareDocumentPosition(submission) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
    )
    .toBe(true);
  for (const label of [
    '学习资源',
    '二手交易',
    '校园工作',
    '普通论坛',
    '匿名树洞',
  ]) {
    await expect(tabs.getByText(label, { exact: true })).toBeVisible();
  }

  await page.locator('input[name="title"]').fill(resourceTitle);
  await page.getByLabel('课程笔记').check();
  await page.getByLabel('自定义标签 1').fill('重复标签');
  await page.getByLabel('自定义标签 2').fill('重复标签');
  await page.getByRole('button', { name: '提交审核' }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: '自定义标签不能重复，请修改第二个标签。' }),
  ).toBeVisible();
  await expect(page.getByLabel('自定义标签 2')).toBeFocused();

  await page.getByLabel('自定义标签 1').clear();
  await page.getByLabel('自定义标签 2').clear();
  await page.getByRole('button', { name: '提交审核' }).click();
  await expect(page.getByText('发布成功，内容已公开。')).toBeVisible();
  await expectStudentSessionActive(page);

  await page.goto('/me/submissions');
  await expectStudentSessionActive(page);
  const resourceRow = page
    .locator('article')
    .filter({ hasText: resourceTitle });
  await expect(resourceRow).toContainText('已发布');
  page.once('dialog', (dialog) => dialog.accept());
  await resourceRow.getByRole('button', { name: '删除' }).click();
  await expect(resourceRow).toHaveCount(0);
  await expect
    .poll(async () => {
      const result = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "Resource"
         WHERE "authorId" = $1 AND title = $2`,
        [studentId, resourceTitle],
      );
      return result.rows[0]?.count;
    })
    .toBe('0');

  const aiHost = required('AI_ALLOWED_HOSTS').split(',')[0]?.trim();
  if (!aiHost) throw new Error('AI_ALLOWED_HOSTS must contain one host.');
  await db.query(
    `INSERT INTO "AiModerationConfig"
      (id, "campusId", enabled, "baseUrl", model, "encryptedApiKey",
       "apiKeyLastFour", "encryptionVersion", "timeoutMs",
       "reviewThreshold", "blockThreshold", "createdAt", "updatedAt")
     VALUES ($1, $2, true, $3, 'e2e-governance-model', $4, 'test', 1,
             8000, 40, 80, now(), now())`,
    [
      aiConfigId,
      campusId,
      `https://${aiHost}/v1`,
      JSON.stringify({ e2e: 'not-a-real-api-key' }),
    ],
  );

  await page.context().clearCookies();
  await signIn(page, adminEmail, adminPassword);
  await page.goto('/admin/blocked-words');
  for (const word of blockedWordDefaults) {
    await expect(page.getByText(word.original, { exact: true })).toBeVisible();
  }

  await page.goto('/admin/ai-settings');
  const aiToggle = page.getByRole('checkbox', { name: '启用 AI 审核' });
  await expect(aiToggle).toBeChecked();
  await aiToggle.uncheck();
  await expect(
    page.getByText('AI 审核已暂停：屏蔽词仍会拦截，其余内容自动公开。', {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel('治理原因')
    .fill('E2E 验证管理员可以暂停付费 AI 审核。');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByRole('status')).toHaveText('AI 审核设置已保存。');
  await expect
    .poll(async () => {
      const result = await db.query<{ enabled: boolean }>(
        `SELECT enabled FROM "AiModerationConfig" WHERE id = $1`,
        [aiConfigId],
      );
      return result.rows[0]?.enabled;
    })
    .toBe(false);

  for (const viewport of [
    { height: 900, width: 1440 },
    { height: 844, width: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(
      page.getByText('CampusLink 是面向西大学子的校园公共空间。', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText('公开内容经过审核，匿名树洞也为表达保留边界。'),
    ).toHaveCount(0);
    await expectFooterAtViewportBottom(page);
  }
});
