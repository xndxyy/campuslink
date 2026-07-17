import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { expect, test } from '../helpers/playwright-e2e';
import { hash } from 'bcryptjs';
import { Pool } from 'pg';

import { assertSafeDestructiveE2eEnvironment } from '../helpers/e2e-database-safety';
import { hasCompleteGovernanceE2eEnvironment } from '../helpers/e2e-environment';

test.skip(
  !hasCompleteGovernanceE2eEnvironment(process.env),
  'Requires live database, application, and storage services.',
);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for live E2E.`);
  return value;
}

const runId = randomUUID();
const adminId = `e2e-announcement-admin-${runId}`;
const adminEmail = `announcement-admin-${runId}@campuslink.test`;
const password = randomBytes(32).toString('base64url');
const title = `暑期校园交易安全提醒 ${runId}`;
const body = `请在校内公共区域当面检查物品。\n不要提前转账，遇到可疑情况请及时举报。`;
let db: Pool | undefined;
let campusId = '';
let previousPinnedId: string | null = null;
let announcementId: string | null = null;
let assetId: string | null = null;
let storageKey: string | null = null;

function storageClient() {
  return new S3Client({
    credentials: {
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    endpoint: required('S3_ENDPOINT'),
    forcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
    region: required('S3_REGION'),
  });
}

test.beforeAll(async () => {
  assertSafeDestructiveE2eEnvironment(process.env);
  db = new Pool({ connectionString: process.env.DATABASE_URL });
  const campus = await db.query<{ id: string }>(
    `SELECT id FROM "Campus"
     WHERE slug = $1 AND "isActive" = true`,
    [process.env.DEFAULT_CAMPUS_SLUG?.trim() || 'campuslink'],
  );
  if (!campus.rows[0]) throw new Error('The active default campus is missing.');
  campusId = campus.rows[0].id;
  const pinned = await db.query<{ id: string }>(
    `SELECT id FROM "Announcement"
     WHERE "campusId" = $1 AND "isPinned" = true
     ORDER BY "publishedAt" DESC, id DESC LIMIT 1`,
    [campusId],
  );
  previousPinnedId = pinned.rows[0]?.id ?? null;
  await db.query(
    `INSERT INTO "User"
      (id, "campusId", name, email, "passwordHash", role, status,
       "emailVerifiedAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'ADMIN', 'ACTIVE', now(), now(), now())`,
    [
      adminId,
      campusId,
      '公告端到端管理员',
      adminEmail,
      await hash(password, 12),
    ],
  );
});

test.afterAll(async () => {
  if (!db) return;
  const errors: unknown[] = [];
  const attempt = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      errors.push(error);
    }
  };
  const storage = storageClient();
  if (storageKey) {
    await attempt(() =>
      storage.send(
        new DeleteObjectCommand({
          Bucket: required('S3_BUCKET'),
          Key: storageKey!,
        }),
      ),
    );
  }
  await attempt(() =>
    db!.query(`DELETE FROM "Session" WHERE "userId" = $1`, [adminId]),
  );
  await attempt(() =>
    db!.query(`DELETE FROM "AuditLog" WHERE "actorId" = $1`, [adminId]),
  );
  if (assetId) {
    await attempt(() =>
      db!.query(`DELETE FROM "Asset" WHERE id = $1`, [assetId]),
    );
  }
  if (announcementId) {
    await attempt(() =>
      db!.query(`DELETE FROM "Announcement" WHERE id = $1`, [announcementId]),
    );
  }
  if (storageKey) {
    await attempt(() =>
      db!.query(`DELETE FROM "StorageDeletionJob" WHERE "storageKey" = $1`, [
        storageKey,
      ]),
    );
  }
  if (previousPinnedId) {
    await attempt(() =>
      db!.query(
        `UPDATE "Announcement" SET "isPinned" = true
         WHERE id = $1 AND "campusId" = $2`,
        [previousPinnedId, campusId],
      ),
    );
  }
  await attempt(() => db!.query(`DELETE FROM "User" WHERE id = $1`, [adminId]));
  storage.destroy();
  await db.end();
  if (errors.length > 0) throw errors[0];
});

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/auth/sign-in');
  await page.locator('input[name="email"]').fill(adminEmail);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).not.toHaveURL(/auth\/sign-in/);
  const cookie = (await page.context().cookies()).find(
    (item) =>
      item.name === 'campuslink-dev-session' ||
      item.name === '__Host-campuslink-session',
  );
  if (!cookie) throw new Error('The E2E admin session cookie was not set.');
  const tokenHash = createHash('sha256').update(cookie.value).digest('hex');
  const session = await db!.query<{ userId: string }>(
    `SELECT "userId" FROM "Session" WHERE "sessionTokenHash" = $1`,
    [tokenHash],
  );
  expect(session.rows[0]?.userId).toBe(adminId);
}

test('administrator publishes, pins, previews, and permanently deletes an announcement', async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await signIn(page);
  await page.goto('/admin/announcements');
  await expect(page.getByRole('heading', { name: '公告管理' })).toBeVisible();
  await page.getByLabel('公告标题').fill(title);
  await page.getByLabel('公告正文').fill(body);
  await page.getByLabel('置顶此公告').check();
  await page
    .getByRole('region', { name: '公告封面图' })
    .locator('input[type="file"]')
    .setInputFiles(path.resolve('tests/fixtures/marketplace.png'));
  await expect(page.getByText('文件上传完成。')).toBeVisible();
  await page.getByRole('button', { name: '发布公告' }).click();
  await expect(page.getByText('公告已发布。')).toBeVisible();
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  const record = await db!.query<{
    assetId: string;
    id: string;
    storageKey: string;
  }>(
    `SELECT announcement.id, asset.id AS "assetId",
            asset."storageKey" AS "storageKey"
     FROM "Announcement" AS announcement
     JOIN "Asset" AS asset ON asset."announcementId" = announcement.id
     WHERE announcement."authorId" = $1 AND announcement.title = $2`,
    [adminId, title],
  );
  expect(record.rows).toHaveLength(1);
  announcementId = record.rows[0]!.id;
  assetId = record.rows[0]!.assetId;
  storageKey = record.rows[0]!.storageKey;

  await page.goto('/');
  await expect(page.locator('.category-strip')).toBeInViewport({ ratio: 0.01 });
  const banner = page.getByRole('link', { name: new RegExp(title) });
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute(
    'href',
    `/announcements?announcement=${announcementId}`,
  );
  await banner.click();
  await expect(page).toHaveURL(
    new RegExp(`/announcements\\?announcement=${announcementId}$`),
  );
  const drawer = page.getByRole('dialog', { name: title });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(body.split('\n')[0]!);
  let bounds = await drawer.boundingBox();
  expect(bounds?.x).toBeGreaterThan(700);
  expect(bounds?.width).toBeLessThan(700);
  const image = drawer.locator(`img[src*="/api/assets/${assetId}/read"]`);
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => {
        const img = element as HTMLImageElement;
        return img.complete && img.naturalWidth > 0;
      }),
    )
    .toBe(true);

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/announcements$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.goto(`/announcements?announcement=${announcementId}`);

  await page.setViewportSize({ height: 760, width: 375 });
  await page.reload();
  bounds = await page.getByRole('dialog', { name: title }).boundingBox();
  expect(bounds?.x).toBe(0);
  expect(bounds?.width).toBe(375);
  await page.goto('/');
  await expect(page.locator('.category-strip')).toBeVisible();

  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto('/admin/announcements');
  const row = page
    .locator('.announcement-admin-row')
    .filter({ hasText: title });
  await row.getByRole('button', { name: '永久删除' }).click();
  const confirm = page.getByRole('dialog', { name: `永久删除“${title}”` });
  await expect(confirm).toContainText('不可恢复');
  await confirm.getByRole('button', { name: '确认永久删除' }).click();
  await expect(row).toHaveCount(0);
  await expect
    .poll(async () => {
      const remaining = await db!.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "Announcement" WHERE id = $1`,
        [announcementId],
      );
      return remaining.rows[0]?.count;
    })
    .toBe('0');

  const storage = storageClient();
  try {
    await expect
      .poll(async () => {
        try {
          await storage.send(
            new HeadObjectCommand({
              Bucket: required('S3_BUCKET'),
              Key: storageKey!,
            }),
          );
          return 'present';
        } catch (error) {
          const status = (error as { $metadata?: { httpStatusCode?: number } })
            .$metadata?.httpStatusCode;
          return status === 404 ? 'missing' : 'error';
        }
      })
      .toBe('missing');
  } finally {
    storage.destroy();
  }
});
