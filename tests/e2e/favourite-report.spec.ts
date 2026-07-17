import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '../helpers/playwright-e2e';
import { hash } from 'bcryptjs';
import { Pool } from 'pg';
import { shouldRunSharedAccountE2e } from '../helpers/e2e-environment';

const runSharedAccountE2e = shouldRunSharedAccountE2e(process.env);
const runId = randomUUID();
const password = randomBytes(32).toString('base64url');
const reporterId = `e2e-engagement-user-${runId}`;
const reporterEmail = `engagement-${runId}@campuslink.test`;
const targetId = `e2e-engagement-item-${runId}`;
const reportDetails = `E2E report submitted through the real published detail ${runId}.`;
let db: Pool | undefined;
let reporterCampusId = '';
let reportId = '';
let contactAuditId = '';
let sessionId = '';

test.skip(
  !runSharedAccountE2e,
  'Requires complete live E2E services and provisioned accounts.',
);

test.beforeAll(async () => {
  if (!runSharedAccountE2e) return;
  db = new Pool({ connectionString: process.env.DATABASE_URL });
  const passwordHash = await hash(password, 12);
  const client = await db.connect();
  try {
    const sourceTarget = await client.query<{
      campusId: string;
      sellerId: string;
      status: string;
    }>(
      `SELECT "campusId", "sellerId", status::text
       FROM "MarketplaceItem" WHERE id = $1`,
      [process.env.E2E_PUBLISHED_MARKETPLACE_ID],
    );
    const source = sourceTarget.rows[0];
    if (!source || source.status !== 'PUBLISHED') {
      throw new Error('E2E marketplace source is not provisioned.');
    }
    reporterCampusId = source.campusId;
    if (source.sellerId === reporterId) {
      throw new Error(
        'E2E marketplace target must not be owned by reporterId.',
      );
    }

    await client.query('BEGIN');
    await client.query(
      `INSERT INTO "User"
        (id, "campusId", name, email, "passwordHash", role, status,
         "emailVerifiedAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'STUDENT', 'ACTIVE', now(), now(), now())`,
      [
        reporterId,
        reporterCampusId,
        'Engagement E2E Reporter',
        reporterEmail,
        passwordHash,
      ],
    );
    await client.query(
      `INSERT INTO "MarketplaceItem"
        (id, "sellerId", "campusId", title, description, "priceCents",
         condition, "pickupArea", contact, status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 2500, 'GOOD', $6, $7, 'PUBLISHED', now(), now())`,
      [
        targetId,
        source.sellerId,
        reporterCampusId,
        `E2E engagement item ${runId}`,
        'Run-scoped marketplace listing for engagement browser coverage.',
        'North library',
        'seller@campuslink.test',
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

test.afterAll(async () => {
  if (!db) return;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (sessionId) {
      await client.query(`DELETE FROM "Session" WHERE id = $1`, [sessionId]);
    }
    if (contactAuditId) {
      await client.query(`DELETE FROM "AuditLog" WHERE id = $1`, [
        contactAuditId,
      ]);
    }
    if (reportId) {
      await client.query(`DELETE FROM "Report" WHERE id = $1`, [reportId]);
    }
    await client.query(
      `DELETE FROM "Favourite"
       WHERE "userId" = $1 AND "targetType" = 'MARKETPLACE_ITEM' AND "targetId" = $2`,
      [reporterId, targetId],
    );
    await client.query(`DELETE FROM "MarketplaceItem" WHERE id = $1`, [
      targetId,
    ]);
    await client.query(`DELETE FROM "User" WHERE id = $1`, [reporterId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await db.end();
  }
});

test('verified member favourites, reports, and requests marketplace contact', async ({
  page,
}) => {
  await page.goto('/auth/sign-in');
  await page.locator('input[name="email"]').fill(reporterEmail);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).not.toHaveURL(/auth\/sign-in/);
  const sessionCookie = (await page.context().cookies()).find(
    (cookie) =>
      cookie.name === 'campuslink-dev-session' ||
      cookie.name === '__Host-campuslink-session',
  );
  if (!sessionCookie || !db) {
    throw new Error('E2E reporter session was not initialized.');
  }
  const sessionTokenHash = createHash('sha256')
    .update(sessionCookie.value)
    .digest('hex');
  const session = await db.query<{ id: string }>(
    `SELECT id FROM "Session" WHERE "sessionTokenHash" = $1`,
    [sessionTokenHash],
  );
  expect(session.rows[0]).toBeDefined();
  sessionId = session.rows[0]!.id;

  await page.goto(`/marketplace/${targetId}`);
  const favourite = page.getByRole('button', { name: '收藏' });
  await favourite.click();
  await expect(page.getByRole('button', { name: '取消收藏' })).toBeVisible();
  await page.getByRole('button', { name: '取消收藏' }).click();
  await expect(page.getByRole('button', { name: '收藏' })).toBeVisible();

  await page.getByRole('button', { name: '举报内容' }).click();
  const dialog = page.getByRole('dialog', { name: '举报此内容' });
  await dialog.getByLabel('举报原因').selectOption('MISLEADING');
  await dialog.getByLabel('补充说明（可选）').fill(reportDetails);
  await dialog.getByRole('button', { name: '提交举报' }).click();
  await expect(
    page.getByText('举报已提交，感谢你帮助维护校园社区。'),
  ).toBeVisible();
  const report = await db.query<{ id: string }>(
    `SELECT id FROM "Report"
     WHERE "reporterId" = $1 AND "targetType" = 'MARKETPLACE_ITEM'
       AND "targetId" = $2 AND details = $3`,
    [reporterId, targetId, reportDetails],
  );
  expect(report.rows[0]).toBeDefined();
  reportId = report.rows[0]!.id;

  await expect(page.locator('.revealed-contact')).toHaveCount(0);
  await page.getByRole('button', { name: '查看联系方式' }).click();
  await expect(page.locator('.revealed-contact')).toBeVisible();
  const auditResult = await db.query<{ id: string }>(
    `SELECT id FROM "AuditLog"
     WHERE "campusId" = $1 AND "actorId" = $2 AND "subjectType" = 'MARKETPLACE_ITEM'
       AND "subjectId" = $3 AND action = 'MARKETPLACE_CONTACT_REQUESTED'
     ORDER BY "createdAt" DESC, id DESC
     LIMIT 1`,
    [reporterCampusId, reporterId, targetId],
  );
  expect(auditResult.rows[0]).toBeDefined();
  contactAuditId = auditResult.rows[0]!.id;
  await expect(page).not.toHaveURL(/contact=/);
});
