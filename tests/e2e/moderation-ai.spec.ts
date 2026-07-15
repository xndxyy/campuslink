import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { hash } from 'bcryptjs';
import { Pool } from 'pg';

import { assertSafeDestructiveE2eEnvironment } from '../helpers/e2e-database-safety';
import { hasCompleteAiModerationE2eEnvironment } from '../helpers/e2e-environment';

test.skip(
  !hasCompleteAiModerationE2eEnvironment(process.env),
  'Requires an isolated database and a deterministic public HTTPS AI fixture.',
);

const runId = randomUUID();
const campusId = `e2e-ai-campus-${runId}`;
const userId = `e2e-ai-user-${runId}`;
const configId = `e2e-ai-config-${runId}`;
const categorySlug = `ai-${runId}`.slice(0, 64);
const blockedWordId = `e2e-ai-word-${runId}`;
const blockedWord = `e2eblocked${runId.replaceAll('-', '')}`;
const email = `ai-${runId}@campuslink.test`;
const password = randomBytes(32).toString('base64url');
let db: Pool;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for AI moderation E2E.`);
  return value;
}

function encryptedApiKey(plaintext: string) {
  const key = Buffer.from(required('AI_CONFIG_ENCRYPTION_KEY_V1'), 'base64');
  if (key.byteLength !== 32) {
    throw new Error('AI_CONFIG_ENCRYPTION_KEY_V1 must decode to 32 bytes.');
  }
  const iv = randomBytes(12);
  const aad = Buffer.alloc(4);
  aad.writeUInt32BE(1);
  const cipher = createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: 16,
  });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return JSON.stringify({
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    keyVersion: 1,
    tag: cipher.getAuthTag().toString('base64'),
  });
}

test.beforeAll(async () => {
  assertSafeDestructiveE2eEnvironment(process.env);
  db = new Pool({ connectionString: required('DATABASE_URL') });
  const passwordHash = await hash(password, 12);
  await db.query('BEGIN');
  try {
    await db.query(
      `INSERT INTO "Campus"
        (id, slug, name, "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, true, now(), now())`,
      [campusId, `e2e-ai-${runId}`, `AI Moderation E2E ${runId}`],
    );
    await db.query(
      `INSERT INTO "User"
        (id, "campusId", email, "passwordHash", role, status,
         "emailVerifiedAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'STUDENT', 'ACTIVE', now(), now(), now())`,
      [userId, campusId, email, passwordHash],
    );
    await db.query(
      `INSERT INTO "ForumCategory"
        (id, "campusId", slug, label, "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, true, now(), now())`,
      [`e2e-ai-category-${runId}`, campusId, categorySlug, 'AI E2E'],
    );
    await db.query(
      `INSERT INTO "BlockedWord"
        (id, "campusId", original, normalized, category, reason, enabled,
         "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $3, '广告垃圾', $4, true, now(), now())`,
      [blockedWordId, campusId, blockedWord, 'AI E2E local gate fixture.'],
    );
    await db.query(
      `INSERT INTO "AiModerationConfig"
        (id, "campusId", enabled, "baseUrl", model, "encryptedApiKey",
         "apiKeyLastFour", "encryptionVersion", "timeoutMs",
         "reviewThreshold", "blockThreshold", "createdAt", "updatedAt")
       VALUES ($1, $2, true, $3, $4, $5, $6, 1, 8000, 40, 80, now(), now())`,
      [
        configId,
        campusId,
        required('E2E_AI_BASE_URL'),
        required('E2E_AI_MODEL'),
        encryptedApiKey(required('E2E_AI_API_KEY')),
        required('E2E_AI_API_KEY').slice(-4),
      ],
    );
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
    `DELETE FROM "ForumComment" WHERE "postId" IN
    (SELECT id FROM "ForumPost" WHERE "campusId" = $1)`,
    [campusId],
  );
  await db.query(`DELETE FROM "ForumPost" WHERE "campusId" = $1`, [campusId]);
  await db.query(`DELETE FROM "BlockedWord" WHERE "campusId" = $1`, [campusId]);
  await db.query(`DELETE FROM "AiModerationConfig" WHERE "campusId" = $1`, [
    campusId,
  ]);
  await db.query(`DELETE FROM "ForumCategory" WHERE "campusId" = $1`, [
    campusId,
  ]);
  await db.query(`DELETE FROM "Session" WHERE "userId" = $1`, [userId]);
  await db.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
  await db.query(`DELETE FROM "Campus" WHERE id = $1`, [campusId]);
  await db.end();
});

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/auth/sign-in');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/auth\/sign-in/);
}

async function publish(
  page: import('@playwright/test').Page,
  marker: string,
  title: string,
) {
  return page.request.post('/api/forum/posts', {
    data: {
      body: `${marker} 这是一段满足长度要求的校园论坛自动审核测试正文。`,
      category: categorySlug,
      kind: 'DISCUSSION',
      title,
    },
    headers: { origin: new URL(required('APP_URL')).origin },
  });
}

test('PASS, REVIEW, BLOCK, local block, and provider failure follow one contract', async ({
  page,
}) => {
  await signIn(page);

  const passTitle = `CAMPUSLINK_E2E_PASS ${runId}`;
  const pass = await publish(page, '[CAMPUSLINK_E2E_PASS]', passTitle);
  expect(pass.status()).toBe(201);
  await expect(pass.json()).resolves.toMatchObject({ status: 'PUBLISHED' });

  const reviewTitle = `CAMPUSLINK_E2E_REVIEW ${runId}`;
  const review = await publish(page, '[CAMPUSLINK_E2E_REVIEW]', reviewTitle);
  expect(review.status()).toBe(201);
  await expect(review.json()).resolves.toMatchObject({
    message: '内容正在人工审核。',
    status: 'PENDING',
  });

  const blockTitle = `CAMPUSLINK_E2E_BLOCK ${runId}`;
  const blocked = await publish(page, '[CAMPUSLINK_E2E_BLOCK]', blockTitle);
  expect(blocked.status()).toBe(400);
  await expect(blocked.json()).resolves.toMatchObject({
    code: 'CONTENT_BLOCKED',
    reason: expect.any(String),
    suggestion: expect.any(String),
  });
  await expect(
    db.query(
      `SELECT status FROM "ForumPost" WHERE "campusId" = $1 AND title = $2`,
      [campusId, blockTitle],
    ),
  ).resolves.toMatchObject({ rows: [{ status: 'REJECTED' }] });

  const localAssessmentCount = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "ContentAssessment" WHERE "campusId" = $1`,
    [campusId],
  );
  const local = await publish(page, blockedWord, `Local block ${runId}`);
  expect(local.status()).toBe(400);
  await expect(local.json()).resolves.toMatchObject({
    code: 'CONTENT_BLOCKED',
  });
  const afterLocalCount = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "ContentAssessment" WHERE "campusId" = $1`,
    [campusId],
  );
  expect(afterLocalCount.rows[0]?.count).toBe(
    localAssessmentCount.rows[0]?.count,
  );

  await db.query(
    `UPDATE "AiModerationConfig" SET "baseUrl" = $1, "updatedAt" = now()
     WHERE id = $2 AND "campusId" = $3`,
    [required('E2E_AI_FAILURE_BASE_URL'), configId, campusId],
  );
  const skippedTitle = `CAMPUSLINK_E2E_SKIPPED ${runId}`;
  const skipped = await publish(page, '[CAMPUSLINK_E2E_SKIPPED]', skippedTitle);
  expect(skipped.status()).toBe(201);
  await expect(skipped.json()).resolves.toMatchObject({ status: 'PUBLISHED' });
  const skippedEvidence = await db.query(
    `SELECT assessment."providerStatus", audit.action
     FROM "ForumPost" post
     JOIN "ContentAssessment" assessment
       ON assessment."targetType" = 'FORUM_POST' AND assessment."targetId" = post.id
     JOIN "AuditLog" audit
       ON audit."campusId" = post."campusId" AND audit."subjectId" = assessment.id
     WHERE post."campusId" = $1 AND post.title = $2
       AND assessment."providerStatus" = 'SKIPPED'
       AND audit.action = 'AI_CHECK_SKIPPED'`,
    [campusId, skippedTitle],
  );
  expect(skippedEvidence.rows).toHaveLength(1);
});
