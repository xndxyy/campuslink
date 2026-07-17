import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { createDbClient } from '@/lib/db';

const describeWithDatabase = describe.skipIf(!process.env.DATABASE_URL);
const DATABASE_LOCK_WAIT_TIMEOUT_MS = 2_000;
const campusWorkMigrationSql = readFileSync(
  fileURLToPath(
    new URL(
      '../../prisma/migrations/20260713190000_add_tags_and_campus_work/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);
const temporarySchemaPattern = /^campus_work_migration_[0-9a-f]{32}$/;

async function waitForDatabaseLock(
  db: ReturnType<typeof createDbClient>,
  applicationName: string,
) {
  const deadline = Date.now() + DATABASE_LOCK_WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const activity = await db.$queryRawUnsafe<
      Array<{ waitEventType: string | null }>
    >(
      `SELECT wait_event_type AS "waitEventType"
       FROM pg_stat_activity
       WHERE application_name = $1`,
      applicationName,
    );
    if (activity.some(({ waitEventType }) => waitEventType === 'Lock')) {
      return;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(
    `Database client ${applicationName} did not wait on a lock within ${DATABASE_LOCK_WAIT_TIMEOUT_MS}ms`,
  );
}

function safeIntegrationDatabaseUrl(databaseUrl: string | undefined) {
  if (!databaseUrl) {
    throw new Error('Migration harness requires DATABASE_URL.');
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('Migration harness requires a valid DATABASE_URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('Migration harness requires PostgreSQL.');
  }
  const databaseName = decodeURIComponent(
    parsed.pathname.split('/').filter(Boolean).at(-1) ?? '',
  );
  if (!/(_test|_e2e)$/.test(databaseName)) {
    throw new Error('Migration harness database must end in _test or _e2e.');
  }

  return databaseUrl;
}

const legacyCampusWorkSchemaSql = `
CREATE TYPE "ContentStatus" AS ENUM (
  'DRAFT',
  'PENDING',
  'PUBLISHED',
  'REJECTED',
  'HIDDEN',
  'ARCHIVED'
);

CREATE TABLE "Campus" (
  "id" TEXT NOT NULL,
  CONSTRAINT "Campus_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "campusId" TEXT NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "User_campusId_fkey" FOREIGN KEY ("campusId")
    REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Resource" (
  "id" TEXT NOT NULL,
  "campusId" TEXT NOT NULL,
  CONSTRAINT "Resource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Resource_campusId_fkey" FOREIGN KEY ("campusId")
    REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "MarketplaceItem" (
  "id" TEXT NOT NULL,
  "campusId" TEXT NOT NULL,
  CONSTRAINT "MarketplaceItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MarketplaceItem_campusId_fkey" FOREIGN KEY ("campusId")
    REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "JobPost" (
  "id" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "campusId" TEXT NOT NULL,
  "company" VARCHAR(200) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" TEXT NOT NULL,
  "location" VARCHAR(200) NOT NULL,
  "payText" VARCHAR(200) NOT NULL,
  "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobPost_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JobPost_authorId_fkey" FOREIGN KEY ("authorId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JobPost_campusId_fkey" FOREIGN KEY ("campusId")
    REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "Campus" ("id") VALUES ('campus-fixture'), ('campus-other');
INSERT INTO "User" ("id", "campusId") VALUES
  ('user-alpha', 'campus-fixture'),
  ('user-beta', 'campus-fixture');
INSERT INTO "Resource" ("id", "campusId")
  VALUES ('resource-fixture', 'campus-fixture');
INSERT INTO "MarketplaceItem" ("id", "campusId")
  VALUES ('marketplace-fixture', 'campus-fixture');
INSERT INTO "JobPost" (
  "id",
  "authorId",
  "campusId",
  "company",
  "title",
  "description",
  "location",
  "payText",
  "status",
  "createdAt",
  "updatedAt"
) VALUES
  (
    'job-alpha',
    'user-alpha',
    'campus-fixture',
    'Campus Learning Centre',
    'Peer Tutor',
    'Tutor first-year students.',
    'Library Room 1',
    '$20/hour',
    'DRAFT',
    TIMESTAMP '2026-01-02 03:04:05',
    TIMESTAMP '2026-01-03 04:05:06'
  ),
  (
    'job-beta',
    'user-beta',
    'campus-fixture',
    'Student Union',
    'Event Assistant',
    'Help operate the welcome event.',
    'Student Hall',
    '$120/day',
    'PUBLISHED',
    TIMESTAMP '2026-02-03 04:05:06',
    TIMESTAMP '2026-02-04 05:06:07'
  );
`;

describeWithDatabase('database schema constraints', () => {
  let db!: ReturnType<typeof createDbClient>;
  let campusId: string | undefined;
  let cleanupCampusIds: string[] = [];
  let cleanupStorageKeys: string[] = [];
  let reporterId: string | undefined;

  beforeAll(() => {
    db = createDbClient();
  });

  beforeEach(async () => {
    campusId = undefined;
    cleanupCampusIds = [];
    cleanupStorageKeys = [];
    reporterId = undefined;
    const suffix = randomUUID();
    const campus = await db.campus.create({
      data: {
        slug: `test-campus-${suffix}`,
        name: 'Schema Constraints Test Campus',
      },
    });

    campusId = campus.id;
    cleanupCampusIds.push(campus.id);

    const reporter = await db.user.create({
      data: {
        campusId,
        email: `schema-${suffix}@${suffix}.example.test`,
        passwordHash:
          '$2b$12$3PhfWpsS2TCwMa.ASaQKOeM.A7RZOc4xS5b07a0PWAZDvQkQ9t6Mi',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });

    reporterId = reporter.id;
  });

  afterEach(async () => {
    if (reporterId) {
      await db.asset.deleteMany({ where: { ownerId: reporterId } });
    }
    if (reporterId) {
      await db.announcement.deleteMany({ where: { authorId: reporterId } });
    }
    if (cleanupCampusIds.length > 0) {
      await db.contentAssessment.deleteMany({
        where: { campusId: { in: cleanupCampusIds } },
      });
      await db.blockedWord.deleteMany({
        where: { campusId: { in: cleanupCampusIds } },
      });
      await db.aiModerationConfig.deleteMany({
        where: { campusId: { in: cleanupCampusIds } },
      });
      await db.forumLike.deleteMany({
        where: { post: { campusId: { in: cleanupCampusIds } } },
      });
      await db.forumComment.deleteMany({
        where: { post: { campusId: { in: cleanupCampusIds } } },
      });
      await db.forumPost.deleteMany({
        where: { campusId: { in: cleanupCampusIds } },
      });
      await db.forumCategory.deleteMany({
        where: { campusId: { in: cleanupCampusIds } },
      });
      await db.announcement.deleteMany({
        where: { campusId: { in: cleanupCampusIds } },
      });
      await db.resourceTag.deleteMany({
        where: { resource: { campusId: { in: cleanupCampusIds } } },
      });
      await db.marketplaceTag.deleteMany({
        where: { marketplaceItem: { campusId: { in: cleanupCampusIds } } },
      });
      await db.campusWorkTag.deleteMany({
        where: { campusWorkPost: { campusId: { in: cleanupCampusIds } } },
      });
      await db.resource.deleteMany({
        where: { campusId: { in: cleanupCampusIds } },
      });
      await db.marketplaceItem.deleteMany({
        where: { campusId: { in: cleanupCampusIds } },
      });
      await db.campusWorkPost.deleteMany({
        where: { campusId: { in: cleanupCampusIds } },
      });
      await db.tagDefinition.deleteMany({
        where: { campusId: { in: cleanupCampusIds } },
      });
    }
    if (reporterId) {
      await db.user.deleteMany({ where: { id: reporterId } });
    }
    if (cleanupStorageKeys.length > 0) {
      await db.storageDeletionJob.deleteMany({
        where: { storageKey: { in: cleanupStorageKeys } },
      });
    }
    if (cleanupCampusIds.length > 0) {
      await db.campus.deleteMany({
        where: { id: { in: cleanupCampusIds } },
      });
    }
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('rejects duplicate favourites for the same user and target', async () => {
    if (!reporterId) {
      throw new Error('Test reporter setup failed');
    }

    const targetId = `resource-${randomUUID()}`;

    await db.favourite.create({
      data: { userId: reporterId, targetType: 'RESOURCE', targetId },
    });

    await expect(
      db.favourite.create({
        data: { userId: reporterId, targetType: 'RESOURCE', targetId },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects duplicate open reports for the same reporter and target', async () => {
    if (!reporterId || !campusId) {
      throw new Error('Test reporter setup failed');
    }

    const targetId = `resource-${randomUUID()}`;

    const initialReport = await db.report.create({
      data: {
        campusId,
        reporterId,
        targetType: 'RESOURCE',
        targetId,
        details: 'Duplicate open-report constraint test',
        reason: 'OTHER',
      },
    });

    await expect(
      db.report.create({
        data: {
          campusId,
          reporterId,
          targetType: 'RESOURCE',
          targetId,
          details: 'Duplicate open-report constraint test',
          reason: 'OTHER',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await db.report.update({
      where: { id: initialReport.id },
      data: { status: 'DISMISSED' },
    });

    const reopenedReport = await db.report.create({
      data: {
        campusId,
        reporterId,
        targetType: 'RESOURCE',
        targetId,
        details: 'A dismissed report may be reported again',
        reason: 'OTHER',
      },
    });

    expect(reopenedReport.status).toBe('OPEN');
  });

  it('rejects invalid AI moderation thresholds at the database boundary', async () => {
    if (!campusId) {
      throw new Error('Test campus setup failed');
    }

    const directClient = new Client({
      connectionString: safeIntegrationDatabaseUrl(process.env.DATABASE_URL),
    });
    await directClient.connect();
    try {
      const insertConfig = `
        INSERT INTO "AiModerationConfig" (
          id,
          "campusId",
          "baseUrl",
          model,
          "encryptedApiKey",
          "apiKeyLastFour",
          "encryptionVersion",
          "reviewThreshold",
          "blockThreshold",
          "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
      `;

      for (const [reviewThreshold, blockThreshold] of [
        [-1, 80],
        [40, 40],
        [81, 80],
        [40, 101],
      ]) {
        await expect(
          directClient.query(insertConfig, [
            `invalid-thresholds-${randomUUID()}`,
            campusId,
            'https://moderation.example.test/v1',
            'moderation-model',
            'encrypted-key-envelope',
            'test',
            1,
            reviewThreshold,
            blockThreshold,
          ]),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'AiModerationConfig_thresholds_check',
        });
      }
    } finally {
      await directClient.end();
    }
  });

  it('rejects cross-campus assessment configuration references at the database boundary', async () => {
    const suffix = randomUUID();
    const campusAId = `assessment-campus-a-${suffix}`;
    const campusBId = `assessment-campus-b-${suffix}`;
    const configAId = `assessment-config-a-${suffix}`;
    const configBId = `assessment-config-b-${suffix}`;
    const directClient = new Client({
      connectionString: safeIntegrationDatabaseUrl(process.env.DATABASE_URL),
    });
    let transactionStarted = false;

    await directClient.connect();
    try {
      await directClient.query('BEGIN');
      transactionStarted = true;
      await directClient.query(
        `INSERT INTO "Campus" (id, slug, name, "updatedAt")
         VALUES
           ($1, $2, 'Assessment Campus A', now()),
           ($3, $4, 'Assessment Campus B', now())`,
        [
          campusAId,
          `assessment-campus-a-${suffix}`,
          campusBId,
          `assessment-campus-b-${suffix}`,
        ],
      );

      const insertConfig = `
        INSERT INTO "AiModerationConfig" (
          id,
          "campusId",
          "baseUrl",
          model,
          "encryptedApiKey",
          "apiKeyLastFour",
          "encryptionVersion",
          "updatedAt"
        ) VALUES ($1, $2, $3, 'moderation-model', 'encrypted-key-envelope', 'test', 1, now())
      `;
      await directClient.query(insertConfig, [
        configAId,
        campusAId,
        'https://campus-a.example.test/v1',
      ]);
      await directClient.query(insertConfig, [
        configBId,
        campusBId,
        'https://campus-b.example.test/v1',
      ]);

      const insertAssessment = `
        INSERT INTO "ContentAssessment" (
          id,
          "campusId",
          "configId",
          "targetType",
          "targetId",
          decision,
          "providerStatus",
          "updatedAt"
        ) VALUES ($1, $2, $3, 'RESOURCE', $4, 'PASS', 'COMPLETED', now())
      `;
      await expect(
        directClient.query(insertAssessment, [
          `same-campus-assessment-${suffix}`,
          campusAId,
          configAId,
          `same-campus-target-${suffix}`,
        ]),
      ).resolves.toMatchObject({ rowCount: 1 });

      await expect(
        directClient.query(insertAssessment, [
          `cross-campus-assessment-${suffix}`,
          campusAId,
          configBId,
          `cross-campus-target-${suffix}`,
        ]),
      ).rejects.toMatchObject({
        code: '23503',
        constraint: 'ContentAssessment_configId_campusId_fkey',
      });
    } finally {
      if (transactionStarted) {
        await directClient.query('ROLLBACK');
      }
      await directClient.end();
    }
  });

  it('enforces campus-scoped forum categories while allowing an inactive existing category', async () => {
    if (!reporterId || !campusId) {
      throw new Error('Test reporter setup failed');
    }

    const suffix = randomUUID();
    const inactiveCategory = await db.forumCategory.create({
      data: {
        campusId,
        isActive: false,
        label: '已停用分类',
        slug: `inactive-${suffix}`,
      },
    });
    const otherCampus = await db.campus.create({
      data: {
        name: 'Other Forum Campus',
        slug: `other-forum-${suffix}`,
      },
    });
    cleanupCampusIds.push(otherCampus.id);
    const otherCategory = await db.forumCategory.create({
      data: {
        campusId: otherCampus.id,
        label: '其他校园分类',
        slug: `other-only-${suffix}`,
      },
    });

    const inactiveCategoryPost = await db.forumPost.create({
      data: {
        authorId: reporterId,
        body: '数据库仅验证分类存在；停用状态由后续服务层拒绝。',
        campusId,
        category: inactiveCategory.slug,
        kind: 'DISCUSSION',
        title: '停用分类数据库边界',
      },
    });
    expect(inactiveCategoryPost).toMatchObject({
      category: inactiveCategory.slug,
    });

    const directClient = new Client({
      connectionString: safeIntegrationDatabaseUrl(process.env.DATABASE_URL),
    });
    await directClient.connect();
    try {
      const insertDiscussion = `
        INSERT INTO "ForumPost"
          (id, "campusId", kind, "authorId", title, body, category, "updatedAt")
        VALUES ($1, $2, 'DISCUSSION', $3, $4, $5, $6, now())
      `;
      await expect(
        directClient.query(insertDiscussion, [
          `missing-category-${suffix}`,
          campusId,
          reporterId,
          '缺失分类',
          '分类不存在时数据库必须拒绝。',
          `missing-${suffix}`,
        ]),
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        directClient.query(insertDiscussion, [
          `cross-campus-category-${suffix}`,
          campusId,
          reporterId,
          '跨校园分类',
          '不能引用其他校园的话题分类。',
          otherCategory.slug,
        ]),
      ).rejects.toMatchObject({ code: '23503' });

      await expect(
        directClient.query(
          `UPDATE "ForumCategory"
           SET "campusId" = $1
           WHERE id = $2`,
          [otherCampus.id, inactiveCategory.id],
        ),
      ).rejects.toMatchObject({
        code: '23514',
        message: expect.stringContaining(
          'Forum category campus ownership is immutable',
        ),
      });

      const unchangedOwnership = await directClient.query(
        `SELECT
           category."campusId" AS "categoryCampusId",
           post."campusId" AS "postCampusId"
         FROM "ForumCategory" AS category
         JOIN "ForumPost" AS post
           ON post."campusId" = category."campusId"
          AND post.category = category.slug
         WHERE category.id = $1
           AND post.id = $2`,
        [inactiveCategory.id, inactiveCategoryPost.id],
      );
      expect(unchangedOwnership.rows).toStrictEqual([
        { categoryCampusId: campusId, postCampusId: campusId },
      ]);
    } finally {
      await directClient.end();
    }
  });

  it('enforces forum identity shape and rejects direct tree-hole comments', async () => {
    if (!reporterId || !campusId) {
      throw new Error('Test reporter setup failed');
    }

    const suffix = randomUUID().replaceAll('-', '');
    const category = await db.forumCategory.create({
      data: {
        campusId,
        label: '约束测试',
        slug: `constraints-${suffix}`,
      },
    });
    const treeHole = await db.forumPost.create({
      data: {
        anonymousCiphertext: 'v1:authenticated-envelope',
        anonymousFingerprint: 'a'.repeat(64),
        anonymousKeyVersion: 1,
        body: '这是一条用于验证数据库边界的匿名树洞。',
        campusId,
        category: category.slug,
        kind: 'TREE_HOLE',
        publicCode: suffix.slice(0, 12).toUpperCase(),
        title: '匿名树洞约束',
      },
    });

    const directClient = new Client({
      connectionString: safeIntegrationDatabaseUrl(process.env.DATABASE_URL),
    });
    await directClient.connect();
    try {
      await expect(
        directClient.query(
          `INSERT INTO "ForumPost"
             (id, "campusId", kind, title, body, category, "updatedAt")
           VALUES ($1, $2, 'DISCUSSION', $3, $4, $5, now())`,
          [
            `authorless-discussion-${suffix}`,
            campusId,
            '缺少作者',
            '普通讨论没有作者时必须被数据库拒绝。',
            category.slug,
          ],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        directClient.query(
          `INSERT INTO "ForumPost"
             (id, "campusId", kind, "publicCode", title, body, category, "updatedAt")
           VALUES ($1, $2, 'TREE_HOLE', $3, $4, $5, $6, now())`,
          [
            `incomplete-tree-hole-${suffix}`,
            campusId,
            suffix.slice(12, 24).toUpperCase(),
            '缺少匿名信封',
            '树洞缺少完整匿名身份字段时必须被数据库拒绝。',
            category.slug,
          ],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        directClient.query(
          `INSERT INTO "ForumComment"
             (id, "postId", "authorId", body, "updatedAt")
           VALUES ($1, $2, $3, $4, now())`,
          [
            `tree-comment-${suffix}`,
            treeHole.id,
            reporterId,
            '不应允许的树洞评论',
          ],
        ),
      ).rejects.toMatchObject({
        code: '23514',
        message: expect.stringContaining(
          'Tree-hole posts do not accept comments',
        ),
      });
    } finally {
      await directClient.end();
    }
  });

  it('enforces one like and prevents a commented discussion becoming a tree hole', async () => {
    if (!reporterId || !campusId) {
      throw new Error('Test reporter setup failed');
    }

    const suffix = randomUUID().replaceAll('-', '');
    const category = await db.forumCategory.create({
      data: {
        campusId,
        label: '互动约束',
        slug: `interaction-${suffix}`,
      },
    });
    const post = await db.forumPost.create({
      data: {
        authorId: reporterId,
        body: '这是一条用于验证评论和点赞约束的普通讨论。',
        campusId,
        category: category.slug,
        kind: 'DISCUSSION',
        title: '互动约束',
      },
    });
    const comment = await db.forumComment.create({
      data: {
        authorId: reporterId,
        body: '一级评论',
        postId: post.id,
      },
    });
    await db.forumLike.create({
      data: { postId: post.id, userId: reporterId },
    });

    const directClient = new Client({
      connectionString: safeIntegrationDatabaseUrl(process.env.DATABASE_URL),
    });
    await directClient.connect();
    try {
      await expect(
        directClient.query(
          `INSERT INTO "ForumLike" (id, "userId", "postId")
           VALUES ($1, $2, $3)`,
          [`duplicate-like-${suffix}`, reporterId, post.id],
        ),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'ForumLike_userId_postId_key',
      });

      const replacementPostId = `moved-${suffix}`;
      await expect(
        directClient.query(
          `UPDATE "ForumPost"
           SET id = $2,
               kind = 'TREE_HOLE',
               "authorId" = NULL,
               "anonymousCiphertext" = $3,
               "anonymousFingerprint" = $4,
               "anonymousKeyVersion" = 1,
               "publicCode" = $5
           WHERE id = $1`,
          [
            post.id,
            replacementPostId,
            'v1:authenticated-envelope',
            'b'.repeat(64),
            suffix.slice(0, 12).toUpperCase(),
          ],
        ),
      ).rejects.toMatchObject({
        code: '23514',
        message: expect.stringContaining(
          'Commented forum posts cannot become tree holes',
        ),
      });

      const unchanged = await directClient.query(
        `SELECT
           post.id AS "postId",
           post.kind::text AS kind,
           comment."postId" AS "commentPostId",
           EXISTS (
             SELECT 1 FROM "ForumPost" AS replacement WHERE replacement.id = $3
           ) AS "replacementPostExists"
         FROM "ForumPost" AS post
         JOIN "ForumComment" AS comment ON comment.id = $2
         WHERE post.id = $1`,
        [post.id, comment.id, replacementPostId],
      );
      expect(unchanged.rows).toStrictEqual([
        {
          commentPostId: post.id,
          kind: 'DISCUSSION',
          postId: post.id,
          replacementPostExists: false,
        },
      ]);
    } finally {
      await directClient.end();
    }
  });

  it('serializes comment insertion against a post kind update', async () => {
    if (!reporterId || !campusId) {
      throw new Error('Test reporter setup failed');
    }

    const suffix = randomUUID().replaceAll('-', '');
    const category = await db.forumCategory.create({
      data: {
        campusId,
        label: '评论并发约束',
        slug: `comment-lock-${suffix}`,
      },
    });
    const post = await db.forumPost.create({
      data: {
        authorId: reporterId,
        body: '评论插入持有父帖锁时，帖子类型更新必须串行等待。',
        campusId,
        category: category.slug,
        kind: 'DISCUSSION',
        title: '评论锁序列化',
      },
    });
    const inserterName = `forum-comment-inserter-${suffix}`;
    const updaterName = `forum-post-kind-updater-${suffix}`;
    const connectionString = safeIntegrationDatabaseUrl(
      process.env.DATABASE_URL,
    );
    const inserter = new Client({
      application_name: inserterName,
      connectionString,
    });
    const updater = new Client({
      application_name: updaterName,
      connectionString,
    });

    await Promise.all([inserter.connect(), updater.connect()]);
    try {
      await Promise.all([
        inserter.query("SET statement_timeout = '3s'"),
        updater.query("SET statement_timeout = '3s'"),
      ]);
      await inserter.query('BEGIN');
      await inserter.query(
        `INSERT INTO "ForumComment"
           (id, "postId", "authorId", body, "updatedAt")
         VALUES ($1, $2, $3, $4, now())`,
        [
          `serialized-comment-${suffix}`,
          post.id,
          reporterId,
          '该评论应先提交，再由帖子类型保护触发器拒绝更新。',
        ],
      );

      const kindUpdate = expect(
        updater.query(
          `UPDATE "ForumPost" SET kind = 'TREE_HOLE' WHERE id = $1`,
          [post.id],
        ),
      ).rejects.toMatchObject({
        code: '23514',
        message: expect.stringContaining(
          'Commented forum posts cannot become tree holes',
        ),
      });

      await waitForDatabaseLock(db, updaterName);
      await inserter.query('COMMIT');
      await kindUpdate;

      await expect(
        db.forumPost.findUniqueOrThrow({ where: { id: post.id } }),
      ).resolves.toMatchObject({ kind: 'DISCUSSION' });
      await expect(
        db.forumComment.count({ where: { postId: post.id } }),
      ).resolves.toBe(1);
    } finally {
      await Promise.allSettled([
        inserter.query('ROLLBACK'),
        updater.query('ROLLBACK'),
      ]);
      await Promise.all([inserter.end(), updater.end()]);
    }
  }, 10_000);

  it('orders user deletion before self-comment parent locking', async () => {
    if (!reporterId || !campusId) {
      throw new Error('Test reporter setup failed');
    }

    const suffix = randomUUID().replaceAll('-', '');
    const category = await db.forumCategory.create({
      data: {
        campusId,
        label: '用户删除并发约束',
        slug: `user-delete-lock-${suffix}`,
      },
    });
    const post = await db.forumPost.create({
      data: {
        authorId: reporterId,
        body: '自评论插入必须先等待用户父记录，再锁帖子父记录。',
        campusId,
        category: category.slug,
        kind: 'DISCUSSION',
        title: '用户优先锁序',
      },
    });
    const deleterName = `forum-user-deleter-${suffix}`;
    const inserterName = `forum-self-comment-inserter-${suffix}`;
    const connectionString = safeIntegrationDatabaseUrl(
      process.env.DATABASE_URL,
    );
    const deleter = new Client({
      application_name: deleterName,
      connectionString,
    });
    const inserter = new Client({
      application_name: inserterName,
      connectionString,
    });

    await Promise.all([deleter.connect(), inserter.connect()]);
    try {
      await Promise.all([
        deleter.query("SET statement_timeout = '3s'"),
        inserter.query("SET statement_timeout = '3s'"),
      ]);
      await deleter.query('BEGIN');
      await deleter.query(`SELECT id FROM "User" WHERE id = $1 FOR UPDATE`, [
        reporterId,
      ]);

      const commentInsert = expect(
        inserter.query(
          `INSERT INTO "ForumComment"
             (id, "postId", "authorId", body, "updatedAt")
           VALUES ($1, $2, $3, $4, now())`,
          [
            `deleted-user-comment-${suffix}`,
            post.id,
            reporterId,
            '父用户被删除后，该评论必须由外键拒绝。',
          ],
        ),
      ).rejects.toMatchObject({ code: '23503' });

      await waitForDatabaseLock(db, inserterName);
      await deleter.query(`DELETE FROM "User" WHERE id = $1`, [reporterId]);
      await deleter.query('COMMIT');
      await commentInsert;

      await expect(
        db.forumPost.findUnique({ where: { id: post.id } }),
      ).resolves.toBeNull();
    } finally {
      await Promise.allSettled([
        deleter.query('ROLLBACK'),
        inserter.query('ROLLBACK'),
      ]);
      await Promise.all([deleter.end(), inserter.end()]);
    }
  }, 10_000);

  it('uses every forum discovery and identity index', async () => {
    const expectedIndexes = [
      {
        fragment: '("campusId", "anonymousFingerprint", "createdAt", id)',
        indexName: 'ForumPost_campusId_anonymousFingerprint_createdAt_id_idx',
        method: 'btree',
      },
      {
        fragment: '("campusId", kind, status, category, "createdAt", id)',
        indexName: 'ForumPost_campusId_kind_status_category_createdAt_id_idx',
        method: 'btree',
      },
      {
        fragment: 'USING gin (body gin_trgm_ops)',
        indexName: 'ForumPost_body_trgm_idx',
        method: 'gin',
      },
      {
        fragment: 'USING gin (title gin_trgm_ops)',
        indexName: 'ForumPost_title_trgm_idx',
        method: 'gin',
      },
    ] as const;
    const metadata = await db.$queryRaw<
      Array<{
        definition: string;
        indexName: string;
        method: string;
        ready: boolean;
        valid: boolean;
      }>
    >`
      SELECT
        index_relation.relname AS "indexName",
        access_method.amname AS method,
        index_metadata.indisvalid AS valid,
        index_metadata.indisready AS ready,
        pg_get_indexdef(index_relation.oid) AS definition
      FROM pg_catalog.pg_index AS index_metadata
      JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.oid = index_metadata.indexrelid
      JOIN pg_catalog.pg_class AS table_relation
        ON table_relation.oid = index_metadata.indrelid
      JOIN pg_catalog.pg_am AS access_method
        ON access_method.oid = index_relation.relam
      WHERE table_relation.oid = to_regclass('public."ForumPost"')
        AND index_relation.relname IN (
          'ForumPost_campusId_anonymousFingerprint_createdAt_id_idx',
          'ForumPost_campusId_kind_status_category_createdAt_id_idx',
          'ForumPost_body_trgm_idx',
          'ForumPost_title_trgm_idx'
        )
      ORDER BY index_relation.relname
    `;

    expect(metadata).toHaveLength(expectedIndexes.length);
    for (const expected of expectedIndexes) {
      expect(metadata).toContainEqual(
        expect.objectContaining({
          indexName: expected.indexName,
          method: expected.method,
          ready: true,
          valid: true,
        }),
      );
      expect(
        metadata.find(({ indexName }) => indexName === expected.indexName)
          ?.definition,
      ).toContain(expected.fragment);
    }

    const plans = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return Promise.all([
        tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
          `EXPLAIN (COSTS OFF)
           SELECT id FROM "ForumPost"
           WHERE "campusId" = $1
             AND kind = 'DISCUSSION'
             AND status = 'PUBLISHED'
             AND category = $2
           ORDER BY "createdAt" DESC, id DESC
           LIMIT 20`,
          campusId,
          'campus-life',
        ),
        tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
          `EXPLAIN (COSTS OFF)
           SELECT id FROM "ForumPost"
           WHERE "campusId" = $1
             AND "anonymousFingerprint" = $2
           ORDER BY "createdAt" DESC, id DESC
           LIMIT 20`,
          campusId,
          'a'.repeat(64),
        ),
        tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
          `EXPLAIN (COSTS OFF)
           SELECT id FROM "ForumPost" WHERE title ILIKE $1`,
          '%probe%',
        ),
        tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
          `EXPLAIN (COSTS OFF)
           SELECT id FROM "ForumPost" WHERE body ILIKE $1`,
          '%probe%',
        ),
      ]);
    });
    const planText = plans.map((plan) =>
      plan.map((row) => row['QUERY PLAN']).join('\n'),
    );
    expect(planText[0]).toMatch(
      /ForumPost_campusId_kind_status_(?:category_)?createdAt_id_idx/,
    );
    expect(planText[1]).toContain(
      'ForumPost_campusId_anonymousFingerprint_createdAt_id_idx',
    );
    expect(planText[2]).toContain('ForumPost_title_trgm_idx');
    expect(planText[3]).toContain('ForumPost_body_trgm_idx');
  });

  it('allows one cover per announcement and rejects a duplicate cover', async () => {
    if (!reporterId || !campusId) {
      throw new Error('Test reporter setup failed');
    }

    const [firstAnnouncement, secondAnnouncement] = await Promise.all([
      db.announcement.create({
        data: {
          authorId: reporterId,
          body: 'First schema constraint announcement',
          campusId,
          title: 'First announcement',
        },
      }),
      db.announcement.create({
        data: {
          authorId: reporterId,
          body: 'Second schema constraint announcement',
          campusId,
          title: 'Second announcement',
        },
      }),
    ]);

    await Promise.all([
      db.asset.create({
        data: {
          announcementId: firstAnnouncement.id,
          contentType: 'image/png',
          kind: 'ANNOUNCEMENT_IMAGE',
          ownerId: reporterId,
          sizeBytes: BigInt(1_024),
          status: 'READY',
          storageKey: `announcements/${reporterId}/${randomUUID()}.png`,
        },
      }),
      db.asset.create({
        data: {
          announcementId: secondAnnouncement.id,
          contentType: 'image/webp',
          kind: 'ANNOUNCEMENT_IMAGE',
          ownerId: reporterId,
          sizeBytes: BigInt(2_048),
          status: 'READY',
          storageKey: `announcements/${reporterId}/${randomUUID()}.webp`,
        },
      }),
    ]);

    await expect(
      db.asset.create({
        data: {
          announcementId: firstAnnouncement.id,
          contentType: 'image/avif',
          kind: 'ANNOUNCEMENT_IMAGE',
          ownerId: reporterId,
          sizeBytes: BigInt(512),
          status: 'READY',
          storageKey: `announcements/${reporterId}/${randomUUID()}.avif`,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('sets a cover asset announcement id to null when its announcement is deleted', async () => {
    if (!reporterId || !campusId) {
      throw new Error('Test reporter setup failed');
    }

    const announcement = await db.announcement.create({
      data: {
        authorId: reporterId,
        body: 'Set-null announcement relation test',
        campusId,
        title: 'Set null cover',
      },
    });
    const asset = await db.asset.create({
      data: {
        announcementId: announcement.id,
        contentType: 'image/png',
        kind: 'ANNOUNCEMENT_IMAGE',
        ownerId: reporterId,
        sizeBytes: BigInt(1_024),
        status: 'READY',
        storageKey: `announcements/${reporterId}/${randomUUID()}.png`,
      },
    });

    await db.announcement.delete({ where: { id: announcement.id } });

    await expect(
      db.asset.findUniqueOrThrow({ where: { id: asset.id } }),
    ).resolves.toMatchObject({ announcementId: null });
  });

  it('restricts deleting an author while their announcement exists', async () => {
    if (!reporterId || !campusId) {
      throw new Error('Test reporter setup failed');
    }

    await db.announcement.create({
      data: {
        authorId: reporterId,
        body: 'Author restriction relation test',
        campusId,
        title: 'Restrict author',
      },
    });

    await expect(
      db.user.delete({ where: { id: reporterId } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('restricts deleting a campus referenced only by an announcement', async () => {
    if (!reporterId) {
      throw new Error('Test reporter setup failed');
    }

    const suffix = randomUUID();
    const announcementCampus = await db.campus.create({
      data: {
        slug: `announcement-campus-${suffix}`,
        name: 'Announcement-only Campus',
      },
    });
    cleanupCampusIds.push(announcementCampus.id);
    await db.announcement.create({
      data: {
        authorId: reporterId,
        body: 'Campus restriction relation test',
        campusId: announcementCampus.id,
        title: 'Restrict campus',
      },
    });

    await expect(
      db.campus.delete({ where: { id: announcementCampus.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('applies deletion job defaults and rejects duplicate storage keys', async () => {
    const storageKey = `announcements/deletion-test/${randomUUID()}.png`;
    cleanupStorageKeys.push(storageKey);

    const job = await db.storageDeletionJob.create({ data: { storageKey } });

    expect(job).toMatchObject({
      attempts: 0,
      lastError: null,
      storageKey,
    });
    expect(job.nextAttempt).toBeInstanceOf(Date);
    await expect(
      db.storageDeletionJob.create({ data: { storageKey } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('scopes tag slug uniqueness by campus and content kind', async () => {
    if (!campusId) {
      throw new Error('Test campus setup failed');
    }

    const suffix = randomUUID();
    const otherCampus = await db.campus.create({
      data: {
        slug: `tag-scope-campus-${suffix}`,
        name: 'Second Tag Scope Campus',
      },
    });
    cleanupCampusIds.push(otherCampus.id);

    await db.tagDefinition.create({
      data: {
        campusId,
        label: 'Campus help',
        scope: 'CAMPUS_WORK',
        slug: 'campus-help',
      },
    });

    await expect(
      db.tagDefinition.create({
        data: {
          campusId,
          label: 'Duplicate campus help',
          scope: 'CAMPUS_WORK',
          slug: 'campus-help',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await expect(
      Promise.all([
        db.tagDefinition.create({
          data: {
            campusId,
            label: 'Marketplace help',
            scope: 'MARKETPLACE',
            slug: 'campus-help',
          },
        }),
        db.tagDefinition.create({
          data: {
            campusId: otherCampus.id,
            label: 'Other campus help',
            scope: 'CAMPUS_WORK',
            slug: 'campus-help',
          },
        }),
      ]),
    ).resolves.toHaveLength(2);
  });

  it('enforces composite uniqueness and real foreign keys for every tag join', async () => {
    if (!campusId || !reporterId) {
      throw new Error('Test content setup failed');
    }
    const joinCampusId = campusId;

    const [resource, marketplaceItem, campusWorkPost] = await Promise.all([
      db.resource.create({
        data: {
          authorId: reporterId,
          campusId,
          summary: 'Resource join constraint fixture',
          title: 'Tagged resource',
        },
      }),
      db.marketplaceItem.create({
        data: {
          campusId,
          condition: 'GOOD',
          contact: 'schema-test@example.test',
          description: 'Marketplace join constraint fixture',
          pickupArea: 'Library',
          priceCents: 100,
          sellerId: reporterId,
          title: 'Tagged marketplace item',
        },
      }),
      db.campusWorkPost.create({
        data: {
          authorId: reporterId,
          campusId,
          description: 'Campus-work join constraint fixture',
          location: 'Campus',
          payText: 'Negotiable',
          title: 'Tagged campus work',
        },
      }),
    ]);
    const [resourceTag, marketplaceTag, campusWorkTag] = await Promise.all([
      db.tagDefinition.create({
        data: {
          campusId,
          label: 'Notes',
          scope: 'RESOURCE',
          slug: 'notes',
        },
      }),
      db.tagDefinition.create({
        data: {
          campusId,
          label: 'Electronics',
          scope: 'MARKETPLACE',
          slug: 'electronics',
        },
      }),
      db.tagDefinition.create({
        data: {
          campusId,
          label: 'Campus errand',
          scope: 'CAMPUS_WORK',
          slug: 'campus-errand',
        },
      }),
    ]);

    await Promise.all([
      db.resourceTag.create({
        data: {
          campusId,
          resourceId: resource.id,
          scope: 'RESOURCE',
          tagId: resourceTag.id,
        },
      }),
      db.marketplaceTag.create({
        data: {
          campusId,
          marketplaceItemId: marketplaceItem.id,
          scope: 'MARKETPLACE',
          tagId: marketplaceTag.id,
        },
      }),
      db.campusWorkTag.create({
        data: {
          campusId,
          campusWorkPostId: campusWorkPost.id,
          scope: 'CAMPUS_WORK',
          tagId: campusWorkTag.id,
        },
      }),
    ]);

    await expect(
      db.resourceTag.create({
        data: {
          campusId,
          resourceId: resource.id,
          scope: 'RESOURCE',
          tagId: resourceTag.id,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      db.marketplaceTag.create({
        data: {
          campusId,
          marketplaceItemId: marketplaceItem.id,
          scope: 'MARKETPLACE',
          tagId: marketplaceTag.id,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      db.campusWorkTag.create({
        data: {
          campusId,
          campusWorkPostId: campusWorkPost.id,
          scope: 'CAMPUS_WORK',
          tagId: campusWorkTag.id,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    for (const operation of [
      () =>
        db.resourceTag.create({
          data: {
            campusId: joinCampusId,
            resourceId: resource.id,
            scope: 'RESOURCE',
            tagId: `missing-${randomUUID()}`,
          },
        }),
      () =>
        db.resourceTag.create({
          data: {
            campusId: joinCampusId,
            resourceId: `missing-${randomUUID()}`,
            scope: 'RESOURCE',
            tagId: resourceTag.id,
          },
        }),
      () =>
        db.marketplaceTag.create({
          data: {
            campusId: joinCampusId,
            marketplaceItemId: marketplaceItem.id,
            scope: 'MARKETPLACE',
            tagId: `missing-${randomUUID()}`,
          },
        }),
      () =>
        db.marketplaceTag.create({
          data: {
            campusId: joinCampusId,
            marketplaceItemId: `missing-${randomUUID()}`,
            scope: 'MARKETPLACE',
            tagId: marketplaceTag.id,
          },
        }),
      () =>
        db.campusWorkTag.create({
          data: {
            campusId: joinCampusId,
            campusWorkPostId: campusWorkPost.id,
            scope: 'CAMPUS_WORK',
            tagId: `missing-${randomUUID()}`,
          },
        }),
      () =>
        db.campusWorkTag.create({
          data: {
            campusId: joinCampusId,
            campusWorkPostId: `missing-${randomUUID()}`,
            scope: 'CAMPUS_WORK',
            tagId: campusWorkTag.id,
          },
        }),
    ]) {
      await expect(operation()).rejects.toMatchObject({ code: 'P2003' });
    }

    await expect(
      db.tagDefinition.delete({ where: { id: resourceTag.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });

    await Promise.all([
      db.resource.delete({ where: { id: resource.id } }),
      db.marketplaceItem.delete({ where: { id: marketplaceItem.id } }),
      db.campusWorkPost.delete({ where: { id: campusWorkPost.id } }),
    ]);
    await expect(
      Promise.all([
        db.resourceTag.findUnique({
          where: {
            resourceId_tagId: {
              resourceId: resource.id,
              tagId: resourceTag.id,
            },
          },
        }),
        db.marketplaceTag.findUnique({
          where: {
            marketplaceItemId_tagId: {
              marketplaceItemId: marketplaceItem.id,
              tagId: marketplaceTag.id,
            },
          },
        }),
        db.campusWorkTag.findUnique({
          where: {
            campusWorkPostId_tagId: {
              campusWorkPostId: campusWorkPost.id,
              tagId: campusWorkTag.id,
            },
          },
        }),
      ]),
    ).resolves.toEqual([null, null, null]);
  });
});

describeWithDatabase('campus-work migration harness', () => {
  it('copies jobs, verifies the legacy JobPost sync bridge, and enforces tag isolation', async () => {
    const databaseUrl = safeIntegrationDatabaseUrl(process.env.DATABASE_URL);
    const temporarySchema = `campus_work_migration_${randomUUID().replaceAll('-', '')}`;
    if (!temporarySchemaPattern.test(temporarySchema)) {
      throw new Error('Generated migration schema name is unsafe.');
    }

    const migrationClient = new Client({ connectionString: databaseUrl });
    let schemaCreated = false;

    await migrationClient.connect();
    try {
      await migrationClient.query(`CREATE SCHEMA "${temporarySchema}"`);
      schemaCreated = true;
      await migrationClient.query(`SET search_path TO "${temporarySchema}"`);
      await migrationClient.query(legacyCampusWorkSchemaSql);
      await migrationClient.query(campusWorkMigrationSql);

      const copied = await migrationClient.query({
        rowMode: 'array',
        text: `
          SELECT
            "id",
            "authorId",
            "campusId",
            "company",
            "title",
            "description",
            "location",
            "payText",
            "status"::text,
            to_char("createdAt", 'YYYY-MM-DD HH24:MI:SS'),
            to_char("updatedAt", 'YYYY-MM-DD HH24:MI:SS'),
            "contact"
          FROM "CampusWorkPost"
          ORDER BY "id"
        `,
      });
      expect(copied.rows).toStrictEqual([
        [
          'job-alpha',
          'user-alpha',
          'campus-fixture',
          'Campus Learning Centre',
          'Peer Tutor',
          'Tutor first-year students.',
          'Library Room 1',
          '$20/hour',
          'DRAFT',
          '2026-01-02 03:04:05',
          '2026-01-03 04:05:06',
          null,
        ],
        [
          'job-beta',
          'user-beta',
          'campus-fixture',
          'Student Union',
          'Event Assistant',
          'Help operate the welcome event.',
          'Student Hall',
          '$120/day',
          'PUBLISHED',
          '2026-02-03 04:05:06',
          '2026-02-04 05:06:07',
          null,
        ],
      ]);

      await migrationClient.query(`
        UPDATE "CampusWorkPost"
        SET "contact" = 'preserve-this-contact'
        WHERE "id" = 'job-beta'
      `);
      await migrationClient.query(`
        UPDATE "JobPost"
        SET
          "company" = 'Updated Student Union',
          "title" = 'Updated Event Assistant',
          "description" = 'Updated through the legacy writer.',
          "location" = 'Updated Student Hall',
          "payText" = '$140/day',
          "status" = 'HIDDEN',
          "updatedAt" = TIMESTAMP '2026-02-05 06:07:08'
        WHERE "id" = 'job-beta'
      `);
      const updatedCopy = await migrationClient.query({
        rowMode: 'array',
        text: `
          SELECT
            "company",
            "title",
            "description",
            "location",
            "payText",
            "status"::text,
            to_char("updatedAt", 'YYYY-MM-DD HH24:MI:SS'),
            "contact"
          FROM "CampusWorkPost"
          WHERE "id" = 'job-beta'
        `,
      });
      expect(updatedCopy.rows).toStrictEqual([
        [
          'Updated Student Union',
          'Updated Event Assistant',
          'Updated through the legacy writer.',
          'Updated Student Hall',
          '$140/day',
          'HIDDEN',
          '2026-02-05 06:07:08',
          'preserve-this-contact',
        ],
      ]);

      await migrationClient.query(`
        INSERT INTO "JobPost" (
          "id",
          "authorId",
          "campusId",
          "company",
          "title",
          "description",
          "location",
          "payText",
          "status",
          "createdAt",
          "updatedAt"
        ) VALUES (
          'job-gamma',
          'user-alpha',
          'campus-fixture',
          'Library',
          'Shelf Assistant',
          'Created through the legacy writer.',
          'Library',
          '$18/hour',
          'PENDING',
          TIMESTAMP '2026-03-04 05:06:07',
          TIMESTAMP '2026-03-05 06:07:08'
        )
      `);
      const insertedCopy = await migrationClient.query(
        `SELECT "id", "contact" FROM "CampusWorkPost" WHERE "id" = 'job-gamma'`,
      );
      expect(insertedCopy.rows).toStrictEqual([
        { contact: null, id: 'job-gamma' },
      ]);
      await migrationClient.query(
        `DELETE FROM "JobPost" WHERE "id" = 'job-gamma'`,
      );
      const deletedCopy = await migrationClient.query(
        `SELECT COUNT(*)::int AS count FROM "CampusWorkPost" WHERE "id" = 'job-gamma'`,
      );
      expect(deletedCopy.rows).toStrictEqual([{ count: 0 }]);

      await migrationClient.query(`
        INSERT INTO "CampusWorkPost" (
          "id",
          "authorId",
          "campusId",
          "title",
          "description",
          "location",
          "payText",
          "updatedAt"
        ) VALUES (
          'campus-work-fixture',
          'user-alpha',
          'campus-fixture',
          'Campus work fixture',
          'Used to verify tag isolation.',
          'Campus',
          'Negotiable',
          TIMESTAMP '2026-04-05 06:07:08'
        )
      `);

      await migrationClient.query(`
        INSERT INTO "TagDefinition"
          ("id", "campusId", "scope", "label", "slug")
        VALUES
          ('tag-resource', 'campus-fixture', 'RESOURCE', 'Notes', 'notes'),
          ('tag-marketplace', 'campus-fixture', 'MARKETPLACE', 'Sale', 'sale'),
          ('tag-campus-work', 'campus-fixture', 'CAMPUS_WORK', 'Errand', 'errand'),
          ('tag-other-resource', 'campus-other', 'RESOURCE', 'Other notes', 'notes'),
          ('tag-other-marketplace', 'campus-other', 'MARKETPLACE', 'Other sale', 'sale'),
          ('tag-other-campus-work', 'campus-other', 'CAMPUS_WORK', 'Other errand', 'errand')
      `);
      await expect(
        migrationClient.query(`
          INSERT INTO "TagDefinition"
            ("id", "campusId", "scope", "label", "slug")
          VALUES
            ('tag-duplicate', 'campus-fixture', 'CAMPUS_WORK', 'Duplicate', 'errand')
        `),
      ).rejects.toMatchObject({ code: '23505' });
      await expect(
        migrationClient.query(`
          INSERT INTO "TagDefinition"
            ("id", "campusId", "scope", "label", "slug")
          VALUES
            ('tag-other-scope', 'campus-fixture', 'MARKETPLACE', 'Errand', 'errand')
        `),
      ).resolves.toBeDefined();

      for (const join of [
        {
          contentColumn: 'resourceId',
          contentId: 'resource-fixture',
          contentTable: 'Resource',
          otherCampusTagId: 'tag-other-resource',
          scope: 'RESOURCE',
          table: 'ResourceTag',
          tagId: 'tag-resource',
          wrongScope: 'MARKETPLACE',
          wrongScopeTagId: 'tag-marketplace',
        },
        {
          contentColumn: 'marketplaceItemId',
          contentId: 'marketplace-fixture',
          contentTable: 'MarketplaceItem',
          otherCampusTagId: 'tag-other-marketplace',
          scope: 'MARKETPLACE',
          table: 'MarketplaceTag',
          tagId: 'tag-marketplace',
          wrongScope: 'CAMPUS_WORK',
          wrongScopeTagId: 'tag-campus-work',
        },
        {
          contentColumn: 'campusWorkPostId',
          contentId: 'campus-work-fixture',
          contentTable: 'CampusWorkPost',
          otherCampusTagId: 'tag-other-campus-work',
          scope: 'CAMPUS_WORK',
          table: 'CampusWorkTag',
          tagId: 'tag-campus-work',
          wrongScope: 'RESOURCE',
          wrongScopeTagId: 'tag-resource',
        },
      ]) {
        const insert = `
          INSERT INTO "${join.table}"
            ("${join.contentColumn}", "tagId", "campusId", "scope")
          VALUES
            ('${join.contentId}', '${join.tagId}', 'campus-fixture', '${join.scope}')
        `;
        await migrationClient.query(insert);
        await expect(migrationClient.query(insert)).rejects.toMatchObject({
          code: '23505',
        });
        await expect(
          migrationClient.query(`
            INSERT INTO "${join.table}"
              ("${join.contentColumn}", "tagId", "campusId", "scope")
            VALUES
              ('${join.contentId}', 'missing-tag', 'campus-fixture', '${join.scope}')
          `),
        ).rejects.toMatchObject({ code: '23503' });
        await expect(
          migrationClient.query(`
            INSERT INTO "${join.table}"
              ("${join.contentColumn}", "tagId", "campusId", "scope")
            VALUES
              ('missing-content', '${join.tagId}', 'campus-fixture', '${join.scope}')
          `),
        ).rejects.toMatchObject({ code: '23503' });
        await expect(
          migrationClient.query(`
            INSERT INTO "${join.table}"
              ("${join.contentColumn}", "tagId", "campusId", "scope")
            VALUES
              ('${join.contentId}', '${join.otherCampusTagId}', 'campus-other', '${join.scope}')
          `),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          migrationClient.query(`
            INSERT INTO "${join.table}"
              ("${join.contentColumn}", "tagId", "campusId", "scope")
            VALUES
              ('${join.contentId}', '${join.wrongScopeTagId}', 'campus-fixture', '${join.scope}')
          `),
        ).rejects.toMatchObject({ code: '23503' });
        await expect(
          migrationClient.query(`
            INSERT INTO "${join.table}"
              ("${join.contentColumn}", "tagId", "campusId", "scope")
            VALUES
              ('${join.contentId}', '${join.wrongScopeTagId}', 'campus-fixture', '${join.wrongScope}')
          `),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          migrationClient.query(
            `UPDATE "${join.contentTable}" SET "campusId" = 'campus-other' WHERE "id" = '${join.contentId}'`,
          ),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          migrationClient.query(
            `DELETE FROM "TagDefinition" WHERE "id" = '${join.tagId}'`,
          ),
        ).rejects.toMatchObject({ code: '23503' });
        await migrationClient.query(
          `DELETE FROM "${join.contentTable}" WHERE "id" = '${join.contentId}'`,
        );
        const remaining = await migrationClient.query(
          `SELECT COUNT(*)::int AS count FROM "${join.table}"`,
        );
        expect(remaining.rows).toStrictEqual([{ count: 0 }]);
      }
    } finally {
      try {
        if (schemaCreated) {
          await migrationClient.query(
            `DROP SCHEMA "${temporarySchema}" CASCADE`,
          );
        }
      } finally {
        await migrationClient.end();
      }
    }
  });

  it('rolls back every migration object on a controlled failure', async () => {
    const databaseUrl = safeIntegrationDatabaseUrl(process.env.DATABASE_URL);
    const temporarySchema = `campus_work_migration_${randomUUID().replaceAll('-', '')}`;
    if (!temporarySchemaPattern.test(temporarySchema)) {
      throw new Error('Generated migration schema name is unsafe.');
    }

    const migrationClient = new Client({ connectionString: databaseUrl });
    let schemaCreated = false;

    await migrationClient.connect();
    try {
      await migrationClient.query(`CREATE SCHEMA "${temporarySchema}"`);
      schemaCreated = true;
      await migrationClient.query(`SET search_path TO "${temporarySchema}"`);
      await migrationClient.query(legacyCampusWorkSchemaSql);

      const failingMigrationSql = campusWorkMigrationSql.replace(
        /COMMIT;\s*$/,
        () =>
          `DO $$ BEGIN RAISE EXCEPTION 'forced migration rollback'; END $$;\nCOMMIT;`,
      );
      expect(failingMigrationSql).not.toBe(campusWorkMigrationSql);
      await expect(
        migrationClient.query(failingMigrationSql),
      ).rejects.toMatchObject({ code: 'P0001' });
      await migrationClient.query('ROLLBACK');

      const rolledBackObjects = await migrationClient.query(`
        SELECT
          to_regtype('"TagScope"') AS "tagScope",
          to_regclass('"TagDefinition"') AS "tagDefinition",
          to_regclass('"CampusWorkPost"') AS "campusWorkPost"
      `);
      expect(rolledBackObjects.rows).toStrictEqual([
        {
          campusWorkPost: null,
          tagDefinition: null,
          tagScope: null,
        },
      ]);

      const rolledBackCode = await migrationClient.query(
        `
          SELECT
            (
              SELECT COUNT(*)::int
              FROM pg_catalog.pg_proc AS procedure
              JOIN pg_catalog.pg_namespace AS namespace
                ON namespace.oid = procedure.pronamespace
              WHERE namespace.nspname = $1
                AND procedure.proname IN (
                  '_sync_job_post_to_campus_work',
                  '_validate_tag_join_campus',
                  '_protect_tagged_content_campus'
                )
            ) AS functions,
            (
              SELECT COUNT(*)::int
              FROM pg_catalog.pg_trigger AS trigger
              JOIN pg_catalog.pg_class AS relation
                ON relation.oid = trigger.tgrelid
              JOIN pg_catalog.pg_namespace AS namespace
                ON namespace.oid = relation.relnamespace
              WHERE namespace.nspname = $1
                AND NOT trigger.tgisinternal
            ) AS triggers
        `,
        [temporarySchema],
      );
      expect(rolledBackCode.rows).toStrictEqual([
        { functions: 0, triggers: 0 },
      ]);

      const legacyRows = await migrationClient.query(
        `SELECT COUNT(*)::int AS count FROM "JobPost"`,
      );
      expect(legacyRows.rows).toStrictEqual([{ count: 2 }]);
    } finally {
      try {
        if (schemaCreated) {
          await migrationClient.query(
            `DROP SCHEMA "${temporarySchema}" CASCADE`,
          );
        }
      } finally {
        await migrationClient.end();
      }
    }
  });
});
