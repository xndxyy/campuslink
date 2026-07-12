import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { hasCompleteE2eEnvironment } from '../helpers/e2e-environment';

test.describe.configure({ mode: 'serial' });

test.skip(
  !hasCompleteE2eEnvironment(process.env),
  'Requires complete live E2E services and provisioned student/moderator accounts.',
);

const runId = randomUUID();
const pendingResourceId = `e2e-pending-${runId}`;
const reportedResourceId = `e2e-reported-${runId}`;
const reportId = `e2e-report-${runId}`;
const pendingTitle = `E2E pending moderation ${runId}`;
const reportDetails = `E2E report moderation ${runId}`;
let db: Pool | undefined;
let moderatorId = '';

async function signIn(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
) {
  await page.goto('/auth/sign-in');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/auth\/sign-in/);
}

test.beforeAll(async () => {
  if (!hasCompleteE2eEnvironment(process.env)) return;
  db = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const users = await client.query<{
      campusId: string;
      email: string;
      emailVerifiedAt: Date | null;
      id: string;
      role: string;
      status: string;
    }>(
      `SELECT id, email, "campusId", "emailVerifiedAt", role::text, status::text
       FROM "User" WHERE email = ANY($1::text[])`,
      [[process.env.E2E_VERIFIED_EMAIL, process.env.E2E_MODERATOR_EMAIL]],
    );
    const student = users.rows.find(
      (user) => user.email === process.env.E2E_VERIFIED_EMAIL,
    );
    const moderator = users.rows.find(
      (user) => user.email === process.env.E2E_MODERATOR_EMAIL,
    );
    if (
      !student ||
      student.role !== 'STUDENT' ||
      student.status !== 'ACTIVE' ||
      !student.emailVerifiedAt
    ) {
      throw new Error('E2E verified student is not provisioned and active.');
    }
    if (
      !moderator ||
      !['MODERATOR', 'ADMIN'].includes(moderator.role) ||
      moderator.status !== 'ACTIVE' ||
      !moderator.emailVerifiedAt
    ) {
      throw new Error('E2E moderator is not provisioned and active.');
    }
    if (student.campusId !== moderator.campusId) {
      throw new Error('E2E student and moderator must share a campus.');
    }
    moderatorId = moderator.id;
    await client.query(
      `INSERT INTO "Resource"
        (id, "authorId", "campusId", title, summary, tags, status, "createdAt", "updatedAt")
       VALUES
        ($1, $2, $3, $4, $5, ARRAY[]::text[], 'PENDING', now(), now()),
        ($6, $2, $3, $7, $8, ARRAY[]::text[], 'PUBLISHED', now(), now())`,
      [
        pendingResourceId,
        student.id,
        student.campusId,
        pendingTitle,
        'E2E pending resource reviewed through the real moderator workspace.',
        reportedResourceId,
        `E2E reported moderation ${runId}`,
        'E2E published resource hidden through report resolution.',
      ],
    );
    await client.query(
      `INSERT INTO "Report"
        (id, "reporterId", "targetType", "targetId", reason, details, status, "createdAt", "updatedAt")
       VALUES ($1, $2, 'RESOURCE', $3, 'PROHIBITED', $4, 'OPEN', now(), now())`,
      [reportId, student.id, reportedResourceId, reportDetails],
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
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM "AuditLog" WHERE "actorId" = $1 AND "subjectId" = ANY($2::text[])`,
        [moderatorId, [pendingResourceId, reportedResourceId, reportId]],
      );
      await client.query(
        `DELETE FROM "ModerationAction" WHERE "actorId" = $1 AND "subjectId" = ANY($2::text[])`,
        [moderatorId, [pendingResourceId, reportedResourceId, reportId]],
      );
      await client.query(`DELETE FROM "Report" WHERE id = $1`, [reportId]);
      await client.query(`DELETE FROM "Resource" WHERE id = ANY($1::text[])`, [
        [pendingResourceId, reportedResourceId],
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await db.end();
  }
});

test('student access to the administration workspace is denied', async ({
  page,
}) => {
  await signIn(
    page,
    process.env.E2E_VERIFIED_EMAIL!,
    process.env.E2E_VERIFIED_PASSWORD!,
  );
  const response = await page.goto('/admin');
  expect(response?.status()).toBe(404);
});

test('moderator approves content and resolves a report with complete audit records', async ({
  page,
}) => {
  await signIn(
    page,
    process.env.E2E_MODERATOR_EMAIL!,
    process.env.E2E_MODERATOR_PASSWORD!,
  );
  await page.goto('/admin/moderation');
  const row = page.locator('tr').filter({ hasText: pendingTitle });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Approve' }).click();
  const approveDialog = page.getByRole('dialog', { name: 'Approve' });
  await approveDialog
    .getByLabel('Decision reason')
    .fill('E2E review confirms the resource meets campus publishing policy.');
  await approveDialog.getByRole('button', { name: 'Confirm Approve' }).click();
  await expect
    .poll(async () => {
      const result = await db!.query<{ status: string }>(
        `SELECT status::text FROM "Resource" WHERE id = $1`,
        [pendingResourceId],
      );
      return result.rows[0]?.status;
    })
    .toBe('PUBLISHED');

  await page.goto('/admin/reports');
  const report = page.locator('article').filter({ hasText: reportDetails });
  await expect(report).toBeVisible();
  await report.getByRole('button', { name: 'Review report' }).click();
  const reportDialog = page.getByRole('dialog', { name: 'Resolve report' });
  await reportDialog.getByLabel('Outcome').selectOption('RESOLVE');
  await reportDialog
    .getByLabel('Resolution reason')
    .fill('E2E review confirms prohibited material and requires hiding.');
  await reportDialog
    .getByLabel('Hide the published target when resolving')
    .check();
  await reportDialog.getByRole('button', { name: 'Record outcome' }).click();

  await expect
    .poll(async () => {
      const result = await db!.query<{
        reportStatus: string;
        resourceStatus: string;
      }>(
        `SELECT r.status::text AS "reportStatus", c.status::text AS "resourceStatus"
       FROM "Report" r JOIN "Resource" c ON c.id = r."targetId"
       WHERE r.id = $1`,
        [reportId],
      );
      return result.rows[0];
    })
    .toEqual({ reportStatus: 'RESOLVED', resourceStatus: 'HIDDEN' });
  const evidence = await db!.query<{ actionCount: string; auditCount: string }>(
    `SELECT
       (SELECT count(*)::text FROM "ModerationAction"
        WHERE "actorId" = $1 AND "subjectId" = ANY($2::text[])) AS "actionCount",
       (SELECT count(*)::text FROM "AuditLog"
        WHERE "actorId" = $1 AND "subjectId" = ANY($2::text[])) AS "auditCount"`,
    [moderatorId, [pendingResourceId, reportedResourceId, reportId]],
  );
  expect(evidence.rows[0]).toEqual({ actionCount: '3', auditCount: '3' });
});
