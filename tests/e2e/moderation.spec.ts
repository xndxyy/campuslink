import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { hasCompleteE2eEnvironment } from '../helpers/e2e-environment';

test.describe.configure({ mode: 'serial' });

test.skip(
  !hasCompleteE2eEnvironment(process.env),
  'Requires complete live E2E services and provisioned student/moderator/admin accounts.',
);

const runId = randomUUID();
const pendingResourceId = `e2e-pending-${runId}`;
const rejectedResourceId = `e2e-reject-${runId}`;
const hiddenResourceId = `e2e-hidden-${runId}`;
const reportedResourceId = `e2e-reported-${runId}`;
const reportId = `e2e-report-${runId}`;
const pendingTitle = `E2E pending moderation ${runId}`;
const rejectedTitle = `E2E rejected moderation ${runId}`;
const hiddenTitle = `E2E hidden moderation ${runId}`;
const reportDetails = `E2E report moderation ${runId}`;
const subjectIds = [
  pendingResourceId,
  rejectedResourceId,
  hiddenResourceId,
  reportedResourceId,
  reportId,
];
let db: Pool | undefined;
let setupStartedAt: Date | undefined;
let campusId = '';
let studentId = '';
let moderatorId = '';
let adminId = '';
let originalCampusName = '';
let originalCampusDomain = '';
const userIds = new Map<string, string>();
const sessionIds = new Set<string>();

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
  const userId = userIds.get(email);
  if (db && setupStartedAt && userId) {
    const session = await db.query<{ id: string }>(
      `SELECT id FROM "Session"
       WHERE "userId" = $1 AND "createdAt" >= $2
       ORDER BY "createdAt" DESC, id DESC LIMIT 1`,
      [userId, setupStartedAt],
    );
    if (session.rows[0]) sessionIds.add(session.rows[0].id);
  }
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
      [
        [
          process.env.E2E_VERIFIED_EMAIL,
          process.env.E2E_MODERATOR_EMAIL,
          process.env.E2E_ADMIN_EMAIL,
        ],
      ],
    );
    for (const user of users.rows) userIds.set(user.email, user.id);
    const student = users.rows.find(
      (user) => user.email === process.env.E2E_VERIFIED_EMAIL,
    );
    const moderator = users.rows.find(
      (user) => user.email === process.env.E2E_MODERATOR_EMAIL,
    );
    const admin = users.rows.find(
      (user) => user.email === process.env.E2E_ADMIN_EMAIL,
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
    if (
      !admin ||
      admin.role !== 'ADMIN' ||
      admin.status !== 'ACTIVE' ||
      !admin.emailVerifiedAt
    ) {
      throw new Error('E2E administrator is not provisioned and active.');
    }
    if (
      student.campusId !== moderator.campusId ||
      student.campusId !== admin.campusId
    ) {
      throw new Error('E2E governance accounts must share a campus.');
    }
    campusId = student.campusId;
    studentId = student.id;
    moderatorId = moderator.id;
    adminId = admin.id;
    const campus = await client.query<{
      allowedEmailDomain: string;
      name: string;
    }>(`SELECT name, "allowedEmailDomain" FROM "Campus" WHERE id = $1`, [
      campusId,
    ]);
    originalCampusName = campus.rows[0]!.name;
    originalCampusDomain = campus.rows[0]!.allowedEmailDomain;
    const marker = await client.query<{ startedAt: Date }>(
      `SELECT clock_timestamp() AS "startedAt"`,
    );
    setupStartedAt = marker.rows[0]!.startedAt;
    await client.query(
      `INSERT INTO "Resource"
        (id, "authorId", "campusId", title, summary, tags, status, "createdAt", "updatedAt")
       VALUES
        ($1, $2, $3, $4, $5, ARRAY[]::text[], 'PENDING', now(), now()),
        ($6, $2, $3, $7, $8, ARRAY[]::text[], 'PENDING', now(), now()),
        ($9, $2, $3, $10, $11, ARRAY[]::text[], 'HIDDEN', now(), now()),
        ($12, $2, $3, $13, $14, ARRAY[]::text[], 'PUBLISHED', now(), now())`,
      [
        pendingResourceId,
        studentId,
        campusId,
        pendingTitle,
        'E2E pending resource approved through the real moderator workspace.',
        rejectedResourceId,
        rejectedTitle,
        'E2E pending resource rejected through the real moderator workspace.',
        hiddenResourceId,
        hiddenTitle,
        'E2E hidden resource restored through the real moderator workspace.',
        reportedResourceId,
        `E2E reported moderation ${runId}`,
        'E2E published resource hidden through report resolution.',
      ],
    );
    await client.query(
      `INSERT INTO "Report"
        (id, "campusId", "reporterId", "targetType", "targetId", reason, details, status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'RESOURCE', $4, 'PROHIBITED', $5, 'OPEN', now(), now())`,
      [reportId, campusId, studentId, reportedResourceId, reportDetails],
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
      if (studentId) {
        await client.query(
          `UPDATE "User" SET role = 'STUDENT', status = 'ACTIVE' WHERE id = $1`,
          [studentId],
        );
      }
      if (campusId && originalCampusName && originalCampusDomain) {
        await client.query(
          `UPDATE "Campus" SET name = $2, "allowedEmailDomain" = $3 WHERE id = $1`,
          [campusId, originalCampusName, originalCampusDomain],
        );
      }
      if (sessionIds.size > 0) {
        await client.query(`DELETE FROM "Session" WHERE id = ANY($1::text[])`, [
          [...sessionIds],
        ]);
      }
      if (setupStartedAt) {
        await client.query(
          `DELETE FROM "AuditLog"
           WHERE "campusId" = $1 AND "actorId" = ANY($2::text[])
             AND "createdAt" >= $3
             AND ("subjectId" = ANY($4::text[]) OR "subjectId" = $1)`,
          [
            campusId,
            [moderatorId, adminId],
            setupStartedAt,
            [...subjectIds, studentId],
          ],
        );
      }
      await client.query(
        `DELETE FROM "ModerationAction"
         WHERE "actorId" = $1 AND "subjectId" = ANY($2::text[])`,
        [moderatorId, subjectIds],
      );
      await client.query(`DELETE FROM "Report" WHERE id = $1`, [reportId]);
      await client.query(`DELETE FROM "Resource" WHERE id = ANY($1::text[])`, [
        subjectIds.filter((id) => id !== reportId),
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

test('moderator approves, rejects, restores, triages, and resolves with audit history', async ({
  page,
}) => {
  await signIn(
    page,
    process.env.E2E_MODERATOR_EMAIL!,
    process.env.E2E_MODERATOR_PASSWORD!,
  );
  await page.goto('/admin/moderation?status=PENDING');
  const pendingRow = page.locator('tr').filter({ hasText: pendingTitle });
  await pendingRow.getByRole('button', { name: 'Approve' }).click();
  const approveDialog = page.getByRole('dialog', { name: 'Approve' });
  await approveDialog
    .getByLabel('Decision reason')
    .fill('E2E review confirms the resource meets campus publishing policy.');
  await approveDialog.getByRole('button', { name: 'Confirm Approve' }).click();

  const rejectedRow = page.locator('tr').filter({ hasText: rejectedTitle });
  await rejectedRow.getByRole('button', { name: 'Reject' }).click();
  const rejectDialog = page.getByRole('dialog', { name: 'Reject' });
  await rejectDialog
    .getByLabel('Decision reason')
    .fill('E2E review found missing attribution required by campus policy.');
  await rejectDialog.getByRole('button', { name: 'Confirm Reject' }).click();
  await expect
    .poll(async () => {
      const result = await db!.query<{ id: string; status: string }>(
        `SELECT id, status::text FROM "Resource" WHERE id = ANY($1::text[])`,
        [[pendingResourceId, rejectedResourceId]],
      );
      return Object.fromEntries(result.rows.map((row) => [row.id, row.status]));
    })
    .toEqual({
      [pendingResourceId]: 'PUBLISHED',
      [rejectedResourceId]: 'REJECTED',
    });

  await page.goto('/admin/moderation?status=HIDDEN');
  const hiddenRow = page.locator('tr').filter({ hasText: hiddenTitle });
  await hiddenRow.getByRole('button', { name: 'Restore' }).click();
  const restoreDialog = page.getByRole('dialog', { name: 'Restore' });
  await restoreDialog
    .getByLabel('Decision reason')
    .fill('E2E follow-up confirms the corrected resource may be restored.');
  await restoreDialog.getByRole('button', { name: 'Confirm Restore' }).click();

  await page.goto('/admin/reports');
  const report = page.locator('article').filter({ hasText: reportDetails });
  await expect(
    report.getByRole('link', { name: 'Open target details' }),
  ).toBeVisible();
  await report.getByRole('button', { name: 'Review report' }).click();
  let reportDialog = page.getByRole('dialog', { name: 'Resolve report' });
  await reportDialog
    .getByLabel('Resolution reason')
    .fill('E2E initial triage assigns the report for complete review.');
  await reportDialog.getByRole('button', { name: 'Record outcome' }).click();
  await expect
    .poll(async () => {
      const result = await db!.query<{ status: string }>(
        `SELECT status::text FROM "Report" WHERE id = $1`,
        [reportId],
      );
      return result.rows[0]?.status;
    })
    .toBe('TRIAGED');

  await page.reload();
  const triagedReport = page
    .locator('article')
    .filter({ hasText: reportDetails });
  await expect(
    triagedReport.getByRole('list', { name: 'Prior moderation history' }),
  ).toContainText('TRIAGE');
  await triagedReport.getByRole('button', { name: 'Review report' }).click();
  reportDialog = page.getByRole('dialog', { name: 'Resolve report' });
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
        WHERE "campusId" = $3 AND "actorId" = $1
          AND "subjectId" = ANY($2::text[])) AS "auditCount"`,
    [moderatorId, subjectIds, campusId],
  );
  expect(evidence.rows[0]).toEqual({ actionCount: '6', auditCount: '6' });
});

test('administrator manages users and campus settings, then filters the campus audit', async ({
  page,
}) => {
  await signIn(
    page,
    process.env.E2E_ADMIN_EMAIL!,
    process.env.E2E_ADMIN_PASSWORD!,
  );

  async function manageUser(
    field: 'role' | 'status',
    value: string,
    reason: string,
  ) {
    await page.goto('/admin/users');
    const row = page
      .locator('tr')
      .filter({ hasText: process.env.E2E_VERIFIED_EMAIL! });
    await row.getByRole('button', { name: 'Manage' }).click();
    const dialog = page.getByRole('dialog', { name: 'Manage user' });
    await dialog.locator('select[name="field"]').selectOption(field);
    await dialog.locator(`select[name="${field}"]`).selectOption(value);
    await dialog.getByLabel('Required reason').fill(reason);
    await dialog.getByRole('button', { name: 'Save change' }).click();
  }

  await manageUser(
    'role',
    'MODERATOR',
    'E2E administrator grants a temporary moderation assignment.',
  );
  await expect
    .poll(async () => {
      const result = await db!.query<{ role: string }>(
        `SELECT role::text FROM "User" WHERE id = $1`,
        [studentId],
      );
      return result.rows[0]?.role;
    })
    .toBe('MODERATOR');
  await manageUser(
    'role',
    'STUDENT',
    'E2E administrator ends the temporary moderation assignment.',
  );
  await manageUser(
    'status',
    'SUSPENDED',
    'E2E administrator temporarily suspends the managed account.',
  );
  await manageUser(
    'status',
    'ACTIVE',
    'E2E administrator restores the managed account after review.',
  );

  const temporaryDomain = `${runId}.e2e-admin.test`;
  await page.goto('/admin/settings');
  await page.getByLabel('Campus name').fill(`${originalCampusName} E2E`);
  await page.getByLabel('Allowed email domain').fill(temporaryDomain);
  await page
    .getByLabel('Change reason')
    .fill('E2E administrator verifies audited campus configuration.');
  await page.getByRole('button', { name: 'Save audited settings' }).click();
  await expect
    .poll(async () => {
      const result = await db!.query<{ domain: string }>(
        `SELECT "allowedEmailDomain" AS domain FROM "Campus" WHERE id = $1`,
        [campusId],
      );
      return result.rows[0]?.domain;
    })
    .toBe(temporaryDomain);
  await page.getByLabel('Campus name').fill(originalCampusName);
  await page.getByLabel('Allowed email domain').fill(originalCampusDomain);
  await page
    .getByLabel('Change reason')
    .fill('E2E administrator restores the provisioned campus configuration.');
  await page.getByRole('button', { name: 'Save audited settings' }).click();

  await page.goto(
    `/admin/audit-log?actor=${adminId}&event=USER_ROLE_CHANGED&entityType=USER&entityId=${studentId}&pageSize=1`,
  );
  await expect(page.locator('input[name="actor"]')).toHaveValue(adminId);
  await expect(page.locator('input[name="event"]')).toHaveValue(
    'USER_ROLE_CHANGED',
  );
  await expect(page.getByText('USER_ROLE_CHANGED').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Next page' })).toBeVisible();
});
