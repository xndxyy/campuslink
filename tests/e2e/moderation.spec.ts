import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { hash } from 'bcryptjs';
import { Pool, type PoolClient } from 'pg';
import { assertSafeDestructiveE2eEnvironment } from '../helpers/e2e-database-safety';
import { hasCompleteGovernanceE2eEnvironment } from '../helpers/e2e-environment';

test.skip(
  !hasCompleteGovernanceE2eEnvironment(process.env),
  'Requires live database, application, and storage services.',
);

const runId = randomUUID();
const password = randomBytes(32).toString('base64url');
let passwordHash = '';
const campusId = `e2e-campus-${runId}`;
const campusSlug = `governance-${runId}`;
const campusDomain = `governance-${runId}.test`;
const campusName = `Governance E2E ${runId}`;
const adminId = `e2e-admin-${runId}`;
const reserveAdminId = `e2e-reserve-admin-${runId}`;
const moderatorId = `e2e-moderator-${runId}`;
const managedStudentId = `e2e-managed-${runId}`;
const accessStudentId = `e2e-access-${runId}`;
const authorId = `e2e-author-${runId}`;
const adminEmail = `admin@${campusDomain}`;
const reserveAdminEmail = `reserve-admin@${campusDomain}`;
const moderatorEmail = `moderator@${campusDomain}`;
const managedStudentEmail = `managed@${campusDomain}`;
const accessStudentEmail = `access@${campusDomain}`;
const authorEmail = `author@${campusDomain}`;
const pendingResourceId = `e2e-pending-${runId}`;
const rejectedResourceId = `e2e-reject-${runId}`;
const hiddenResourceId = `e2e-hidden-${runId}`;
const reportedResourceId = `e2e-reported-${runId}`;
const reportId = `e2e-report-${runId}`;
const pendingTitle = `E2E pending moderation ${runId}`;
const rejectedTitle = `E2E rejected moderation ${runId}`;
const hiddenTitle = `E2E hidden moderation ${runId}`;
const reportDetails = `E2E report moderation ${runId}`;

const tracked = {
  assets: new Set<string>(),
  auditLogs: new Set<string>(),
  campuses: new Set([campusId]),
  favourites: new Set<string>(),
  jobPosts: new Set<string>(),
  marketplaceItems: new Set<string>(),
  moderationActions: new Set<string>(),
  reports: new Set([reportId]),
  resources: new Set([
    pendingResourceId,
    rejectedResourceId,
    hiddenResourceId,
    reportedResourceId,
  ]),
  sessions: new Set<string>(),
  users: new Set([
    adminId,
    reserveAdminId,
    moderatorId,
    managedStudentId,
    accessStudentId,
    authorId,
  ]),
};

let db: Pool | undefined;

async function insertUser(
  client: PoolClient,
  input: { email: string; id: string; name: string; role: string },
) {
  await client.query(
    `INSERT INTO "User"
      (id, "campusId", name, email, "passwordHash", role, status,
       "emailVerifiedAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6::"UserRole", 'ACTIVE', now(), now(), now())`,
    [input.id, campusId, input.name, input.email, passwordHash, input.role],
  );
}

async function createFixture() {
  assertSafeDestructiveE2eEnvironment(process.env);
  passwordHash = await hash(password, 12);
  db = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO "Campus"
        (id, slug, name, "allowedEmailDomain", "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, true, now(), now())`,
      [campusId, campusSlug, campusName, campusDomain],
    );
    await insertUser(client, {
      email: adminEmail,
      id: adminId,
      name: 'Governance Admin',
      role: 'ADMIN',
    });
    await insertUser(client, {
      email: reserveAdminEmail,
      id: reserveAdminId,
      name: 'Reserve Governance Admin',
      role: 'ADMIN',
    });
    await insertUser(client, {
      email: moderatorEmail,
      id: moderatorId,
      name: 'Governance Moderator',
      role: 'MODERATOR',
    });
    await insertUser(client, {
      email: managedStudentEmail,
      id: managedStudentId,
      name: 'Managed Governance Student',
      role: 'STUDENT',
    });
    await insertUser(client, {
      email: accessStudentEmail,
      id: accessStudentId,
      name: 'Access Boundary Student',
      role: 'STUDENT',
    });
    await insertUser(client, {
      email: authorEmail,
      id: authorId,
      name: 'Governance Author',
      role: 'STUDENT',
    });
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
        authorId,
        campusId,
        pendingTitle,
        'Run-scoped resource approved through the moderator workspace.',
        rejectedResourceId,
        rejectedTitle,
        'Run-scoped resource rejected through the moderator workspace.',
        hiddenResourceId,
        hiddenTitle,
        'Run-scoped hidden resource restored by a moderator.',
        reportedResourceId,
        `E2E reported moderation ${runId}`,
        'Run-scoped published resource hidden through report resolution.',
      ],
    );
    await client.query(
      `INSERT INTO "Report"
        (id, "campusId", "reporterId", "targetType", "targetId", reason,
         details, status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'RESOURCE', $4, 'PROHIBITED', $5, 'OPEN', now(), now())`,
      [reportId, campusId, authorId, reportedResourceId, reportDetails],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function collectIds(
  client: PoolClient,
  query: string,
  values: unknown[],
  destination: Set<string>,
) {
  const result = await client.query<{ id: string }>(query, values);
  for (const row of result.rows) destination.add(row.id);
}

async function cleanupFixture() {
  if (!db) return;
  const errors: unknown[] = [];
  let client: PoolClient | undefined;
  const attempt = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      errors.push(error);
    }
  };
  try {
    client = await db.connect();
    const userIds = [...tracked.users];
    await attempt(() =>
      collectIds(
        client!,
        `SELECT id FROM "Session" WHERE "userId" = ANY($1::text[])`,
        [userIds],
        tracked.sessions,
      ),
    );
    await attempt(() =>
      collectIds(
        client!,
        `SELECT id FROM "AuditLog" WHERE "campusId" = $1`,
        [campusId],
        tracked.auditLogs,
      ),
    );
    await attempt(() =>
      collectIds(
        client!,
        `SELECT id FROM "ModerationAction" WHERE "actorId" = ANY($1::text[])`,
        [userIds],
        tracked.moderationActions,
      ),
    );
    await attempt(() =>
      collectIds(
        client!,
        `SELECT id FROM "Favourite" WHERE "userId" = ANY($1::text[])`,
        [userIds],
        tracked.favourites,
      ),
    );
    await attempt(() =>
      collectIds(
        client!,
        `SELECT id FROM "Asset" WHERE "ownerId" = ANY($1::text[])`,
        [userIds],
        tracked.assets,
      ),
    );
    await attempt(() =>
      collectIds(
        client!,
        `SELECT id FROM "MarketplaceItem" WHERE "sellerId" = ANY($1::text[])`,
        [userIds],
        tracked.marketplaceItems,
      ),
    );
    await attempt(() =>
      collectIds(
        client!,
        `SELECT id FROM "JobPost" WHERE "authorId" = ANY($1::text[])`,
        [userIds],
        tracked.jobPosts,
      ),
    );
    await attempt(() =>
      client!.query(`DELETE FROM "Session" WHERE id = ANY($1::text[])`, [
        [...tracked.sessions],
      ]),
    );
    await attempt(() =>
      client!.query(`DELETE FROM "AuditLog" WHERE id = ANY($1::text[])`, [
        [...tracked.auditLogs],
      ]),
    );
    await attempt(() =>
      client!.query(
        `DELETE FROM "ModerationAction" WHERE id = ANY($1::text[])`,
        [[...tracked.moderationActions]],
      ),
    );
    await attempt(() =>
      client!.query(`DELETE FROM "Favourite" WHERE id = ANY($1::text[])`, [
        [...tracked.favourites],
      ]),
    );
    await attempt(() =>
      client!.query(`DELETE FROM "Report" WHERE id = ANY($1::text[])`, [
        [...tracked.reports],
      ]),
    );
    await attempt(() =>
      client!.query(`DELETE FROM "Asset" WHERE id = ANY($1::text[])`, [
        [...tracked.assets],
      ]),
    );
    await attempt(() =>
      client!.query(`DELETE FROM "Resource" WHERE id = ANY($1::text[])`, [
        [...tracked.resources],
      ]),
    );
    await attempt(() =>
      client!.query(
        `DELETE FROM "MarketplaceItem" WHERE id = ANY($1::text[])`,
        [[...tracked.marketplaceItems]],
      ),
    );
    await attempt(() =>
      client!.query(`DELETE FROM "JobPost" WHERE id = ANY($1::text[])`, [
        [...tracked.jobPosts],
      ]),
    );
    await attempt(() =>
      client!.query(`DELETE FROM "User" WHERE id = ANY($1::text[])`, [
        [...tracked.users],
      ]),
    );
    await attempt(() =>
      client!.query(`DELETE FROM "Campus" WHERE id = ANY($1::text[])`, [
        [...tracked.campuses],
      ]),
    );
  } finally {
    client?.release();
    await db.end();
  }
  if (errors.length > 0) throw errors[0];
}

async function signIn(
  page: import('@playwright/test').Page,
  email: string,
  expectedUserId: string,
) {
  await page.goto('/auth/sign-in');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/auth\/sign-in/);
  const sessionCookie = (await page.context().cookies()).find(
    (cookie) =>
      cookie.name === 'campuslink-dev-session' ||
      cookie.name === '__Host-campuslink-session',
  );
  if (!sessionCookie) throw new Error('Governance session cookie was not set.');
  const sessionTokenHash = createHash('sha256')
    .update(sessionCookie.value)
    .digest('hex');
  const session = await db!.query<{ id: string; userId: string }>(
    `SELECT id, "userId" FROM "Session"
     WHERE "sessionTokenHash" = $1`,
    [sessionTokenHash],
  );
  expect(session.rows[0]?.userId).toBe(expectedUserId);
  tracked.sessions.add(session.rows[0]!.id);
}

test.beforeAll(createFixture);
test.afterAll(cleanupFixture);

test('run-scoped student access to the administration workspace is denied', async ({
  page,
}) => {
  await signIn(page, accessStudentEmail, accessStudentId);
  const response = await page.goto('/admin');
  expect(response?.status()).toBe(404);
});

test('run-scoped moderator executes the complete content and report lifecycle', async ({
  page,
}) => {
  await signIn(page, moderatorEmail, moderatorId);
  await page.goto('/admin/moderation?status=PENDING');
  const pendingRow = page.locator('tr').filter({ hasText: pendingTitle });
  await pendingRow.getByRole('button', { name: 'Approve' }).click();
  const approveDialog = page.getByRole('dialog', { name: 'Approve' });
  await approveDialog
    .getByLabel('Decision reason')
    .fill('Run-scoped review confirms this resource meets campus policy.');
  await approveDialog.getByRole('button', { name: 'Confirm Approve' }).click();

  const rejectedRow = page.locator('tr').filter({ hasText: rejectedTitle });
  await rejectedRow.getByRole('button', { name: 'Reject' }).click();
  const rejectDialog = page.getByRole('dialog', { name: 'Reject' });
  await rejectDialog
    .getByLabel('Decision reason')
    .fill('Run-scoped review found required attribution was missing.');
  await rejectDialog.getByRole('button', { name: 'Confirm Reject' }).click();

  await page.goto('/admin/moderation?status=HIDDEN');
  const hiddenRow = page.locator('tr').filter({ hasText: hiddenTitle });
  await hiddenRow.getByRole('button', { name: 'Restore' }).click();
  const restoreDialog = page.getByRole('dialog', { name: 'Restore' });
  await restoreDialog
    .getByLabel('Decision reason')
    .fill('Run-scoped follow-up confirms the corrected resource is safe.');
  await restoreDialog.getByRole('button', { name: 'Confirm Restore' }).click();

  await page.goto('/admin/reports');
  const report = page.locator('article').filter({ hasText: reportDetails });
  await report.getByRole('button', { name: 'Review report' }).click();
  let reportDialog = page.getByRole('dialog', { name: 'Resolve report' });
  await reportDialog
    .getByLabel('Resolution reason')
    .fill('Run-scoped triage assigns this report for complete review.');
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
  await triagedReport.getByRole('button', { name: 'Review report' }).click();
  reportDialog = page.getByRole('dialog', { name: 'Resolve report' });
  await reportDialog.getByLabel('Outcome').selectOption('RESOLVE');
  await reportDialog
    .getByLabel('Resolution reason')
    .fill('Run-scoped review confirms prohibited material must be hidden.');
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
        `SELECT report.status::text AS "reportStatus",
                resource.status::text AS "resourceStatus"
         FROM "Report" AS report
         JOIN "Resource" AS resource ON resource.id = report."targetId"
         WHERE report.id = $1`,
        [reportId],
      );
      return result.rows[0];
    })
    .toEqual({ reportStatus: 'RESOLVED', resourceStatus: 'HIDDEN' });
});

test('run-scoped administrator manages users, campus settings, audit filters, and final-admin protection', async ({
  page,
}) => {
  await signIn(page, adminEmail, adminId);

  async function openUserDialog(email: string) {
    await page.goto('/admin/users');
    const emailText = page.getByText(email, { exact: true });
    const row = page.locator('tr').filter({ has: emailText });
    await row.getByRole('button', { name: 'Manage' }).click();
    return page.getByRole('dialog', { name: 'Manage user' });
  }

  async function manageUser(
    email: string,
    field: 'role' | 'status',
    value: string,
    reason: string,
  ) {
    const dialog = await openUserDialog(email);
    await dialog.locator('select[name="field"]').selectOption(field);
    await dialog.locator(`select[name="${field}"]`).selectOption(value);
    await dialog.getByLabel('Required reason').fill(reason);
    await dialog.getByRole('button', { name: 'Save change' }).click();
  }

  await manageUser(
    managedStudentEmail,
    'role',
    'MODERATOR',
    'Run-scoped administrator grants a temporary moderator role.',
  );
  await manageUser(
    managedStudentEmail,
    'role',
    'STUDENT',
    'Run-scoped administrator removes the temporary moderator role.',
  );
  await manageUser(
    managedStudentEmail,
    'status',
    'SUSPENDED',
    'Run-scoped administrator suspends the managed student after review.',
  );
  await manageUser(
    managedStudentEmail,
    'status',
    'ACTIVE',
    'Run-scoped administrator restores the managed student after review.',
  );

  await manageUser(
    reserveAdminEmail,
    'role',
    'STUDENT',
    'Run-scoped administrator completes the reserve governance handoff.',
  );
  const selfDialog = await openUserDialog(adminEmail);
  await selfDialog.locator('select[name="field"]').selectOption('status');
  await selfDialog.locator('select[name="status"]').selectOption('SUSPENDED');
  await selfDialog
    .getByLabel('Required reason')
    .fill('Attempt to suspend the final run-scoped active administrator.');
  await selfDialog.getByRole('button', { name: 'Save change' }).click();
  await expect(page.getByText('Administration state conflict.')).toBeVisible();
  await expect
    .poll(async () => {
      const result = await db!.query<{ count: string }>(
        `SELECT count(*)::text FROM "User"
         WHERE "campusId" = $1 AND role = 'ADMIN' AND status = 'ACTIVE'`,
        [campusId],
      );
      return result.rows[0]?.count;
    })
    .toBe('1');

  const temporaryDomain = `${runId}.governance-updated.test`;
  await page.goto('/admin/settings');
  await page.getByLabel('Campus name').fill(`${campusName} Updated`);
  await page.getByLabel('Allowed email domain').fill(temporaryDomain);
  await page
    .getByLabel('Change reason')
    .fill('Run-scoped administrator verifies isolated campus settings.');
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

  await page.goto(
    `/admin/audit-log?actor=${adminId}&event=USER_ROLE_CHANGED&entityType=USER&entityId=${managedStudentId}&pageSize=1`,
  );
  await expect(page.locator('input[name="actor"]')).toHaveValue(adminId);
  await expect(page.getByText('USER_ROLE_CHANGED').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Next page' })).toBeVisible();
});
