import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { expect, test } from '@playwright/test';
import { hash } from 'bcryptjs';
import { Pool } from 'pg';
import { shouldRunSharedAccountE2e } from '../helpers/e2e-environment';

const runSharedAccountE2e = shouldRunSharedAccountE2e(process.env);

test.skip(
  !runSharedAccountE2e,
  'Requires complete live E2E services and provisioned accounts.',
);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for live E2E.`);
  return value;
}

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

async function createRunScopedPublisher() {
  const runId = randomUUID();
  const id = `e2e-publisher-${runId}`;
  const email = `publisher-${runId}@campuslink.test`;
  const password = randomBytes(32).toString('base64url');
  const passwordHash = await hash(password, 12);
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const campus = await db.query<{ campusId: string }>(
      `SELECT "campusId" FROM "User" WHERE email = $1`,
      [process.env.E2E_VERIFIED_EMAIL],
    );
    if (!campus.rows[0])
      throw new Error('E2E publisher campus is unavailable.');
    await db.query(
      `INSERT INTO "User"
        (id, "campusId", name, email, "passwordHash", role, status,
         "emailVerifiedAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'STUDENT', 'ACTIVE', now(), now(), now())`,
      [
        id,
        campus.rows[0].campusId,
        'Run-scoped Publisher',
        email,
        passwordHash,
      ],
    );
    return { db, email, id, password, runId };
  } catch (error) {
    await db.end();
    throw error;
  }
}

async function cleanupRunScopedPublisher(db: Pool, userId: string) {
  const assets = await db.query<{ storageKey: string }>(
    `SELECT "storageKey" FROM "Asset" WHERE "ownerId" = $1`,
    [userId],
  );
  const storage = storageClient();
  const storageResults = await Promise.allSettled(
    assets.rows.map(({ storageKey }) =>
      storage.send(
        new DeleteObjectCommand({
          Bucket: required('S3_BUCKET'),
          Key: storageKey,
        }),
      ),
    ),
  );
  try {
    await db.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
  } finally {
    await db.end();
    storage.destroy();
  }
  const failedDelete = storageResults.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failedDelete) throw failedDelete.reason;
}

test.afterEach(async ({ page }) => {
  const sessionCookie = (await page.context().cookies()).find(
    (cookie) =>
      cookie.name === 'campuslink-dev-session' ||
      cookie.name === '__Host-campuslink-session',
  );
  if (!sessionCookie) return;
  const sessionTokenHash = createHash('sha256')
    .update(sessionCookie.value)
    .digest('hex');
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await db.query(`DELETE FROM "Session" WHERE "sessionTokenHash" = $1`, [
      sessionTokenHash,
    ]);
  } finally {
    await db.end();
  }
});

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

test('verified student publishes resource, marketplace item, and campus work through real forms', async ({
  page,
}) => {
  const publisher = await createRunScopedPublisher();
  const resourceTitle = `E2E algorithms notes ${publisher.runId}`;
  const marketplaceTitle = `E2E textbook ${publisher.runId}`;
  const campusWorkTitle = `E2E campus event assistant ${publisher.runId}`;
  try {
    await signIn(page, publisher.email, publisher.password);

    await page.goto('/submit/resource');
    await page.locator('input[name="title"]').fill(resourceTitle);
    await page
      .locator('textarea[name="summary"]')
      .fill('Complete E2E lecture notes with worked examples and exercises.');
    await page.getByLabel('自定义标签 1').fill('E2E algorithms');
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles(path.resolve('tests/fixtures/resource.pdf'));
    await expect(page.getByText('Upload is ready.')).toBeVisible();
    await page.locator('button[type="submit"]').last().click();
    await expect(page.locator('[aria-live="polite"]').last()).toContainText(
      '审核',
    );

    await page.goto('/submit/marketplace');
    await page.locator('input[name="title"]').fill(marketplaceTitle);
    await page
      .locator('textarea[name="description"]')
      .fill('A carefully used E2E discrete mathematics textbook.');
    await page.locator('input[name="price"]').fill('19.99');
    await page.locator('input[name="pickupArea"]').fill('North library');
    await page.locator('textarea[name="contact"]').fill('Private campus inbox');
    await page.getByLabel('自定义标签 1').fill('E2E marketplace');
    await page
      .locator('input[type="file"]')
      .setInputFiles(path.resolve('tests/fixtures/marketplace.png'));
    await expect(page.getByText('Upload is ready.')).toBeVisible();
    await page.locator('button[type="submit"]').last().click();
    await expect(page.locator('[aria-live="polite"]').last()).toContainText(
      '审核',
    );

    await page.goto('/submit/campus-work');
    await page.locator('input[name="title"]').fill(campusWorkTitle);
    await page
      .locator('textarea[name="description"]')
      .fill('Help serve students during the E2E weekend lunch shift.');
    await page.locator('input[name="location"]').fill('Student centre');
    await page.locator('input[name="payText"]').fill('$20/hour');
    await page.locator('textarea[name="contact"]').fill('Campus inbox only');
    await page.getByLabel('自定义标签 1').fill('E2E event help');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('[aria-live="polite"]')).toContainText('审核');

    await page.goto('/me/submissions');
    for (const title of [resourceTitle, marketplaceTitle, campusWorkTitle]) {
      const row = page.locator('article').filter({ hasText: title }).first();
      await expect(row).toBeVisible();
      await expect(row).toContainText('PENDING');
    }
  } finally {
    await cleanupRunScopedPublisher(publisher.db, publisher.id);
  }
});

test('published marketplace image renders through the protected signed-read route', async ({
  page,
}) => {
  await page.goto(`/marketplace/${process.env.E2E_PUBLISHED_MARKETPLACE_ID!}`);
  const image = page.locator('img[src*="/api/assets/"][src$="/read"]').first();
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => {
        const img = element as HTMLImageElement;
        return img.complete && img.naturalWidth > 0;
      }),
    )
    .toBe(true);
});

test('unverified account is denied sign-in', async ({ page }) => {
  await page.goto('/auth/sign-in');
  await page
    .locator('input[name="email"]')
    .fill(process.env.E2E_UNVERIFIED_EMAIL!);
  await page
    .locator('input[name="password"]')
    .fill(process.env.E2E_UNVERIFIED_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/auth\/sign-in\?error=/);
});

test('owner edits a provisioned rejected record and resubmits it', async ({
  page,
}) => {
  const kind = process.env.E2E_REJECTED_KIND!;
  const id = process.env.E2E_REJECTED_ID!;
  if (kind !== 'resource') {
    throw new Error('The rejected E2E fixture must be a resource.');
  }
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  let originalRejectedResource:
    | {
        courseCode: string | null;
        status: string;
        summary: string;
        tags: string[];
        title: string;
        updatedAt: Date;
      }
    | undefined;
  try {
    const original = await db.query<
      NonNullable<typeof originalRejectedResource>
    >(
      `SELECT title, summary, "courseCode", tags, status::text, "updatedAt"
       FROM "Resource" WHERE id = $1`,
      [id],
    );
    originalRejectedResource = original.rows[0];
    if (!originalRejectedResource) {
      throw new Error('The rejected E2E resource is unavailable.');
    }

    await signIn(
      page,
      process.env.E2E_VERIFIED_EMAIL!,
      process.env.E2E_VERIFIED_PASSWORD!,
    );
    await page.goto(`/me/submissions/${kind}/${id}/edit`);
    await page.locator('input[name="title"]').fill(`Revised rejected ${kind}`);
    await page.getByRole('button', { name: '保存草稿' }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/me/submissions');
    const row = page
      .locator('article')
      .filter({ hasText: `Revised rejected ${kind}` });
    await expect(row).toContainText('DRAFT');
    await row.getByRole('button', { name: '重新提交' }).click();
    await expect(row).toContainText('PENDING');
  } finally {
    if (originalRejectedResource) {
      await db.query(
        `UPDATE "Resource"
         SET title = $2, summary = $3, "courseCode" = $4, tags = $5,
             status = $6::"ContentStatus", "updatedAt" = $7
         WHERE id = $1`,
        [
          id,
          originalRejectedResource.title,
          originalRejectedResource.summary,
          originalRejectedResource.courseCode,
          originalRejectedResource.tags,
          originalRejectedResource.status,
          originalRejectedResource.updatedAt,
        ],
      );
    }
    await db.end();
  }
});
