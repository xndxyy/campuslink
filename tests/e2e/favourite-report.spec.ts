import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { hasCompleteE2eEnvironment } from '../helpers/e2e-environment';

const reportDetails = 'E2E report submitted through the real published detail.';
let db: Pool | undefined;
let reporterId = '';
const targetId = process.env.E2E_PUBLISHED_MARKETPLACE_ID ?? '';

test.skip(
  !hasCompleteE2eEnvironment(process.env),
  'Requires complete live E2E services and provisioned accounts.',
);

test.beforeAll(async () => {
  if (!hasCompleteE2eEnvironment(process.env)) return;
  db = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const reporterResult = await client.query<{
      campusId: string;
      emailVerifiedAt: Date | null;
      id: string;
      status: string;
    }>(
      `SELECT id, "campusId", "emailVerifiedAt", status::text
       FROM "User" WHERE email = $1`,
      [process.env.E2E_VERIFIED_EMAIL],
    );
    const targetResult = await client.query<{
      campusId: string;
      id: string;
      sellerId: string;
      status: string;
    }>(
      `SELECT id, "campusId", "sellerId", status::text
       FROM "MarketplaceItem" WHERE id = $1`,
      [targetId],
    );
    const reporter = reporterResult.rows[0];
    const target = targetResult.rows[0];
    if (
      !reporter ||
      reporter.status !== 'ACTIVE' ||
      !reporter.emailVerifiedAt
    ) {
      throw new Error('E2E verified reporter is not provisioned and active.');
    }
    reporterId = reporter.id;
    if (!target || target.status !== 'PUBLISHED') {
      throw new Error('E2E marketplace target is not published.');
    }
    if (target.campusId !== reporter.campusId) {
      throw new Error('E2E marketplace target must share the reporter campus.');
    }
    if (target.sellerId === reporterId) {
      throw new Error(
        'E2E marketplace target must not be owned by the reporter.',
      );
    }
    await client.query(
      `DELETE FROM "Favourite"
       WHERE "userId" = $1 AND "targetType" = 'MARKETPLACE_ITEM' AND "targetId" = $2`,
      [reporterId, targetId],
    );
    await client.query(
      `DELETE FROM "Report"
       WHERE "reporterId" = $1 AND "targetType" = 'MARKETPLACE_ITEM'
         AND "targetId" = $2 AND status = 'OPEN'`,
      [reporterId, targetId],
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
    if (reporterId && targetId) {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM "Favourite"
         WHERE "userId" = $1 AND "targetType" = 'MARKETPLACE_ITEM' AND "targetId" = $2`,
        [reporterId, targetId],
      );
      await client.query(
        `DELETE FROM "Report"
         WHERE "reporterId" = $1 AND "targetType" = 'MARKETPLACE_ITEM'
           AND "targetId" = $2 AND details = $3`,
        [reporterId, targetId, reportDetails],
      );
      await client.query('COMMIT');
    }
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
  await page
    .locator('input[name="email"]')
    .fill(process.env.E2E_VERIFIED_EMAIL!);
  await page
    .locator('input[name="password"]')
    .fill(process.env.E2E_VERIFIED_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/auth\/sign-in/);

  await page.goto(`/marketplace/${targetId}`);
  const favourite = page.getByRole('button', { name: 'Add favourite' });
  await favourite.click();
  await expect(
    page.getByRole('button', { name: 'Remove favourite' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Remove favourite' }).click();
  await expect(
    page.getByRole('button', { name: 'Add favourite' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Report content' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report this content' });
  await dialog.getByLabel('Reason').selectOption('MISLEADING');
  await dialog.getByLabel('Optional details').fill(reportDetails);
  await dialog.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByText(/Report received/)).toBeVisible();

  await expect(page.locator('.revealed-contact')).toHaveCount(0);
  await page.getByRole('button', { name: 'Request contact' }).click();
  await expect(page.locator('.revealed-contact')).toBeVisible();
  await expect(page).not.toHaveURL(/contact=/);
});
