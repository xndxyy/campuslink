import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { expect, test } from '@playwright/test';
import { hash } from 'bcryptjs';
import { Pool } from 'pg';
import { assertSafeDestructiveE2eEnvironment } from '../helpers/e2e-database-safety';
import { shouldRunSharedAccountE2e } from '../helpers/e2e-environment';
import { cleanupRunScopedPublisher } from '../helpers/publish-content-cleanup';
import { createPublishContentRunTags } from '../helpers/publish-content-run-tags';

const runSharedAccountE2e = shouldRunSharedAccountE2e(process.env);
if (runSharedAccountE2e) {
  assertSafeDestructiveE2eEnvironment(process.env);
}

test.skip(
  !runSharedAccountE2e,
  'Requires complete live E2E services, provisioned accounts, and an isolated destructive test database.',
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
  const customTags = createPublishContentRunTags(runId);
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
    return {
      auditSubjects: [] as Array<{
        action: string;
        actorId: string;
        subjectId: string;
        subjectType: string;
      }>,
      campusId: campus.rows[0].campusId,
      customTags,
      db,
      email,
      id,
      password,
      runId,
    };
  } catch (error) {
    await db.end();
    throw error;
  }
}

async function cleanupPublisher(
  publisher: Awaited<ReturnType<typeof createRunScopedPublisher>>,
) {
  const storage = storageClient();
  await cleanupRunScopedPublisher(publisher, {
    db: {
      connect: async () => {
        const client = await publisher.db.connect();
        return {
          query: async (sql: string, values?: unknown[]) => {
            const query = await client.query(sql, values);
            return {
              rowCount: query.rowCount,
              rows: query.rows as Array<Record<string, unknown>>,
            };
          },
          release: () => client.release(),
        };
      },
      end: () => publisher.db.end(),
      query: async (sql: string, values?: unknown[]) => {
        const query = await publisher.db.query(sql, values);
        return {
          rowCount: query.rowCount,
          rows: query.rows as Array<Record<string, unknown>>,
        };
      },
    },
    storage: {
      deleteObject: async (storageKey: string) => {
        await storage.send(
          new DeleteObjectCommand({
            Bucket: required('S3_BUCKET'),
            Key: storageKey,
          }),
        );
      },
      destroy: () => storage.destroy(),
    },
  });
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
  const campusWorkContact = 'Campus inbox only';
  try {
    await signIn(page, publisher.email, publisher.password);

    await page.goto('/submit/resource');
    await page.locator('input[name="title"]').fill(resourceTitle);
    await page
      .locator('textarea[name="summary"]')
      .fill('Complete E2E lecture notes with worked examples and exercises.');
    await page
      .getByLabel('自定义标签 1')
      .fill(publisher.customTags.resource.label);
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
    await page
      .getByLabel('自定义标签 1')
      .fill(publisher.customTags.marketplace.label);
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
    await page.locator('textarea[name="contact"]').fill(campusWorkContact);
    await page
      .getByLabel('自定义标签 1')
      .fill(publisher.customTags.campusWork.label);
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('[aria-live="polite"]')).toContainText('审核');

    await page.goto('/me/submissions');
    for (const title of [resourceTitle, marketplaceTitle, campusWorkTitle]) {
      const row = page.locator('article').filter({ hasText: title }).first();
      await expect(row).toBeVisible();
      await expect(row).toContainText('PENDING');
    }

    const campusWorkRows = await publisher.db.query<{
      contact: string | null;
      id: string;
    }>(
      `SELECT id, contact
       FROM "CampusWorkPost"
       WHERE "authorId" = $1 AND title = $2 AND title LIKE $3`,
      [publisher.id, campusWorkTitle, `%${publisher.runId}%`],
    );
    expect(campusWorkRows.rows).toHaveLength(1);
    const campusWork = campusWorkRows.rows[0];
    if (!campusWork?.contact) {
      throw new Error('Run-scoped campus work contact is unavailable.');
    }
    expect(campusWork.contact).toBe(campusWorkContact);

    const published = await publisher.db.query<{ id: string }>(
      `UPDATE "CampusWorkPost"
       SET status = 'PUBLISHED'
       WHERE id = $1 AND "authorId" = $2 AND title = $3
         AND status = 'PENDING'
       RETURNING id`,
      [campusWork.id, publisher.id, campusWorkTitle],
    );
    expect(published.rows).toEqual([{ id: campusWork.id }]);

    const otherActors = await publisher.db.query<{
      campusId: string;
      id: string;
    }>(
      `SELECT id, "campusId"
       FROM "User"
       WHERE email = $1`,
      [process.env.E2E_OTHER_EMAIL],
    );
    expect(otherActors.rows).toHaveLength(1);
    const otherActor = otherActors.rows[0];
    if (!otherActor) throw new Error('E2E non-owner actor is unavailable.');
    expect(otherActor.campusId).toBe(publisher.campusId);
    publisher.auditSubjects.push({
      action: 'CAMPUS_WORK_CONTACT_VIEWED',
      actorId: otherActor.id,
      subjectId: campusWork.id,
      subjectType: 'JOB_POST',
    });

    await page.context().clearCookies();
    await signIn(
      page,
      process.env.E2E_OTHER_EMAIL!,
      process.env.E2E_OTHER_PASSWORD!,
    );
    await page.goto(`/campus-work/${campusWork.id}`);
    const revealContact = page.getByRole('button', {
      name: '查看联系方式',
    });
    await expect(revealContact).toBeVisible();
    await revealContact.click();
    await expect(
      page.getByText(campusWork.contact, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('联系方式访问已记录，请注意线下见面与付款安全。', {
        exact: true,
      }),
    ).toBeVisible();

    const auditRows = await publisher.db.query<{
      action: string;
      actorId: string | null;
      campusId: string;
      details: unknown;
      id: string;
      subjectId: string | null;
      subjectType: string | null;
    }>(
      `SELECT id, "campusId", "actorId", action, "subjectId",
              "subjectType"::text AS "subjectType", details
       FROM "AuditLog"
       WHERE "campusId" = $1 AND action = $2
         AND "subjectType" = $3::"ModerationSubjectType"
         AND "subjectId" = $4 AND "actorId" = $5`,
      [
        publisher.campusId,
        'CAMPUS_WORK_CONTACT_VIEWED',
        'JOB_POST',
        campusWork.id,
        otherActor.id,
      ],
    );
    expect(auditRows.rows).toHaveLength(1);
    expect(auditRows.rows[0]).toMatchObject({
      action: 'CAMPUS_WORK_CONTACT_VIEWED',
      actorId: otherActor.id,
      campusId: otherActor.campusId,
      subjectId: campusWork.id,
      subjectType: 'JOB_POST',
    });
    expect(JSON.stringify(auditRows.rows[0])).not.toContain(campusWork.contact);
  } finally {
    await cleanupPublisher(publisher);
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
      `SELECT title, summary, tags, status::text, "updatedAt"
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
         SET title = $2, summary = $3, tags = $4,
             status = $5::"ContentStatus", "updatedAt" = $6
         WHERE id = $1`,
        [
          id,
          originalRejectedResource.title,
          originalRejectedResource.summary,
          originalRejectedResource.tags,
          originalRejectedResource.status,
          originalRejectedResource.updatedAt,
        ],
      );
    }
    await db.end();
  }
});
