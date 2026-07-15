import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { hash } from 'bcryptjs';
import { Pool, type PoolClient } from 'pg';

import { assertSafeDestructiveE2eEnvironment } from '../helpers/e2e-database-safety';
import { hasCompleteGovernanceE2eEnvironment } from '../helpers/e2e-environment';

const canRun =
  hasCompleteGovernanceE2eEnvironment(process.env) &&
  process.env.ALLOW_DESTRUCTIVE_E2E === 'true';
test.skip(
  !canRun,
  'Requires live services, an isolated _e2e/_test database, and ALLOW_DESTRUCTIVE_E2E=true.',
);

const runId = randomUUID();
const password = randomBytes(32).toString('base64url');
const campusId = `user-governance-campus-${runId}`;
const campusDomain = `user-governance-${runId}.test`;
const adminId = `user-governance-admin-${runId}`;
const targetId = `user-governance-target-${runId}`;
const resourceId = `user-governance-resource-${runId}`;
const reportId = `user-governance-report-${runId}`;
const initialAuditId = `user-governance-audit-${runId}`;
const targetSessionId = `user-governance-session-${runId}`;
const targetName = `治理目标 ${runId}`;
const adminEmail = `admin@${campusDomain}`;
const targetEmail = `target@${campusDomain}`;
const userIds = new Set<string>([adminId, targetId]);
const sessionIds = new Set<string>([targetSessionId]);
const auditIds = new Set<string>([initialAuditId]);
let db: Pool | undefined;
let passwordHash = '';

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
        (id, slug, name, "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, true, now(), now())`,
      [campusId, `user-governance-${runId}`, `User Governance ${runId}`],
    );
    await insertUser(client, {
      email: adminEmail,
      id: adminId,
      name: '用户治理管理员',
      role: 'ADMIN',
    });
    await insertUser(client, {
      email: targetEmail,
      id: targetId,
      name: targetName,
      role: 'STUDENT',
    });
    for (let index = 0; index < 10; index += 1) {
      const id = `user-governance-member-${index}-${runId}`;
      userIds.add(id);
      await insertUser(client, {
        email: `member-${index}@${campusDomain}`,
        id,
        name: `治理成员 ${index}`,
        role: 'STUDENT',
      });
    }
    await client.query(
      `INSERT INTO "Session"
        (id, "sessionTokenHash", "userId", expires, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, now() + interval '1 hour', now(), now())`,
      [targetSessionId, `target-${runId}`, targetId],
    );
    await client.query(
      `INSERT INTO "Resource"
        (id, "authorId", "campusId", title, summary, tags, status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, ARRAY[]::text[], 'PUBLISHED', now(), now())`,
      [
        resourceId,
        targetId,
        campusId,
        `治理发布 ${runId}`,
        'Run-scoped user governance detail record.',
      ],
    );
    await client.query(
      `INSERT INTO "Report"
        (id, "campusId", "reporterId", "targetType", "targetId", reason,
         status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'RESOURCE', $4, 'OTHER', 'OPEN', now(), now())`,
      [reportId, campusId, targetId, resourceId],
    );
    await client.query(
      `INSERT INTO "AuditLog"
        (id, "campusId", "actorId", action, "subjectType", "subjectId", details, "createdAt")
       VALUES ($1, $2, $3, 'E2E_USER_REVIEW', 'USER', $4, $5::jsonb, now())`,
      [
        initialAuditId,
        campusId,
        adminId,
        targetId,
        JSON.stringify({ reason: 'Run-scoped review history.' }),
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function collectFixtureIds() {
  if (!db) return;
  const sessions = await db.query<{ id: string }>(
    `SELECT id FROM "Session" WHERE "userId" = ANY($1::text[])`,
    [[...userIds]],
  );
  for (const row of sessions.rows) sessionIds.add(row.id);
  const audits = await db.query<{ id: string }>(
    `SELECT id FROM "AuditLog" WHERE "campusId" = $1`,
    [campusId],
  );
  for (const row of audits.rows) auditIds.add(row.id);
}

async function cleanupFixture() {
  if (!db) return;
  try {
    await collectFixtureIds();
    await db.query(`DELETE FROM "Session" WHERE id = ANY($1::text[])`, [
      [...sessionIds],
    ]);
    await db.query(`DELETE FROM "AuditLog" WHERE id = ANY($1::text[])`, [
      [...auditIds],
    ]);
    await db.query(`DELETE FROM "Report" WHERE id = ANY($1::text[])`, [
      [reportId],
    ]);
    await db.query(`DELETE FROM "Resource" WHERE id = ANY($1::text[])`, [
      [resourceId],
    ]);
    await db.query(`DELETE FROM "User" WHERE id = ANY($1::text[])`, [
      [...userIds],
    ]);
    await db.query(`DELETE FROM "Campus" WHERE id = ANY($1::text[])`, [
      [campusId],
    ]);
  } finally {
    await db.end();
  }
}

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/auth/sign-in');
  await page.locator('input[name="email"]').fill(adminEmail);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/auth\/sign-in/);
  const sessionCookie = (await page.context().cookies()).find(
    (cookie) =>
      cookie.name === 'campuslink-dev-session' ||
      cookie.name === '__Host-campuslink-session',
  );
  if (!sessionCookie) throw new Error('Administrator session cookie missing.');
  const sessionTokenHash = createHash('sha256')
    .update(sessionCookie.value)
    .digest('hex');
  const session = await db!.query<{ id: string }>(
    `SELECT id FROM "Session" WHERE "sessionTokenHash" = $1`,
    [sessionTokenHash],
  );
  sessionIds.add(session.rows[0]!.id);
}

async function selectedUserId(
  row: import('@playwright/test').Locator,
): Promise<string> {
  const href = await row.getAttribute('href');
  const userId = href
    ? new URL(href, 'http://localhost').searchParams.get('user')
    : null;
  if (!userId) throw new Error('Managed user row has no selected user ID.');
  return userId;
}

test.beforeAll(createFixture);
test.afterAll(cleanupFixture);

test('administrator filters, pages, inspects, and force-signs-out a campus user', async ({
  page,
}) => {
  await signIn(page);
  await page.goto(
    '/admin/users?pageSize=1&role=STUDENT&status=ACTIVE&verified=true',
  );
  const firstPageRows = page.locator('.admin-user-row');
  await expect(firstPageRows).toHaveCount(1);
  const firstPageUserId = await selectedUserId(firstPageRows.first());
  await page.getByRole('link', { name: '下一页' }).click();

  const searchParams = new URL(page.url()).searchParams;
  expect(searchParams.get('cursor')).toBeTruthy();
  expect(searchParams.get('pageSize')).toBe('1');
  expect(searchParams.get('role')).toBe('STUDENT');
  expect(searchParams.get('status')).toBe('ACTIVE');
  expect(searchParams.get('verified')).toBe('true');
  const secondPageRows = page.locator('.admin-user-row');
  await expect(secondPageRows).toHaveCount(1);
  const secondPageUserId = await selectedUserId(secondPageRows.first());
  expect(secondPageUserId).not.toBe(firstPageUserId);
  await expect(
    page.locator(
      `.admin-user-row[href*="user=${encodeURIComponent(firstPageUserId)}"]`,
    ),
  ).toHaveCount(0);

  await page.getByLabel('搜索姓名或邮箱').fill(targetEmail);
  await page.getByLabel('角色').selectOption('STUDENT');
  await page.getByLabel('状态').selectOption('ACTIVE');
  await page.getByLabel('验证状态').selectOption('true');
  await page.getByRole('button', { name: '应用筛选' }).click();
  await expect(page).toHaveURL(/search=target%40/);
  const row = page.locator('.admin-user-row').filter({ hasText: targetEmail });
  await expect(row).toContainText('普通用户');
  await row.click();

  let drawer = page.getByRole('dialog', { name: targetName });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name: '发布内容' }).click();
  drawer = page.getByRole('dialog', { name: targetName });
  await expect(drawer.getByText(`治理发布 ${runId}`)).toBeVisible();
  await drawer.getByRole('link', { name: '举报记录' }).click();
  drawer = page.getByRole('dialog', { name: targetName });
  await expect(drawer.getByText('该用户提交的举报')).toBeVisible();
  await drawer.getByRole('link', { name: '审计记录' }).click();
  drawer = page.getByRole('dialog', { name: targetName });
  await expect(drawer.getByText('其他治理事件')).toBeVisible();
  await drawer.getByRole('link', { name: '账号概览' }).click();
  drawer = page.getByRole('dialog', { name: targetName });

  await drawer.getByRole('button', { name: '强制退出全部设备' }).click();
  const confirmation = page.getByRole('dialog', {
    name: '确认执行“强制退出全部设备”',
  });
  await confirmation
    .getByLabel('操作原因')
    .fill('E2E 安全复核要求该用户退出全部设备。');
  await confirmation.getByRole('button', { name: '确认执行' }).click();

  await expect
    .poll(async () => {
      const result = await db!.query<{ count: string }>(
        `SELECT count(*)::text FROM "Session" WHERE "userId" = $1`,
        [targetId],
      );
      return result.rows[0]?.count;
    })
    .toBe('0');
  await expect
    .poll(async () => {
      const result = await db!.query<{ count: string }>(
        `SELECT count(*)::text FROM "AuditLog"
         WHERE "campusId" = $1 AND action = 'USER_SESSIONS_REVOKED'
           AND "subjectId" = $2
           AND details->>'revokedCount' = '1'`,
        [campusId, targetId],
      );
      return result.rows[0]?.count;
    })
    .toBe('1');
});
