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
  CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketplaceItem" (
  "id" TEXT NOT NULL,
  CONSTRAINT "MarketplaceItem_pkey" PRIMARY KEY ("id")
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

INSERT INTO "Campus" ("id") VALUES ('campus-fixture');
INSERT INTO "User" ("id", "campusId") VALUES
  ('user-alpha', 'campus-fixture'),
  ('user-beta', 'campus-fixture');
INSERT INTO "Resource" ("id") VALUES ('resource-fixture');
INSERT INTO "MarketplaceItem" ("id") VALUES ('marketplace-fixture');
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
        allowedEmailDomain: `${suffix}.example.test`,
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
      await db.jobPost.deleteMany({
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
        data: { resourceId: resource.id, tagId: resourceTag.id },
      }),
      db.marketplaceTag.create({
        data: {
          marketplaceItemId: marketplaceItem.id,
          tagId: marketplaceTag.id,
        },
      }),
      db.campusWorkTag.create({
        data: { campusWorkPostId: campusWorkPost.id, tagId: campusWorkTag.id },
      }),
    ]);

    await expect(
      db.resourceTag.create({
        data: { resourceId: resource.id, tagId: resourceTag.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      db.marketplaceTag.create({
        data: {
          marketplaceItemId: marketplaceItem.id,
          tagId: marketplaceTag.id,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      db.campusWorkTag.create({
        data: { campusWorkPostId: campusWorkPost.id, tagId: campusWorkTag.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    for (const operation of [
      () =>
        db.resourceTag.create({
          data: { resourceId: resource.id, tagId: `missing-${randomUUID()}` },
        }),
      () =>
        db.resourceTag.create({
          data: {
            resourceId: `missing-${randomUUID()}`,
            tagId: resourceTag.id,
          },
        }),
      () =>
        db.marketplaceTag.create({
          data: {
            marketplaceItemId: marketplaceItem.id,
            tagId: `missing-${randomUUID()}`,
          },
        }),
      () =>
        db.marketplaceTag.create({
          data: {
            marketplaceItemId: `missing-${randomUUID()}`,
            tagId: marketplaceTag.id,
          },
        }),
      () =>
        db.campusWorkTag.create({
          data: {
            campusWorkPostId: campusWorkPost.id,
            tagId: `missing-${randomUUID()}`,
          },
        }),
      () =>
        db.campusWorkTag.create({
          data: {
            campusWorkPostId: `missing-${randomUUID()}`,
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
  it('copies pre-migration jobs and enforces scoped tag constraints', async () => {
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
        INSERT INTO "TagDefinition"
          ("id", "campusId", "scope", "label", "slug")
        VALUES
          ('tag-resource', 'campus-fixture', 'RESOURCE', 'Notes', 'notes'),
          ('tag-marketplace', 'campus-fixture', 'MARKETPLACE', 'Sale', 'sale'),
          ('tag-campus-work', 'campus-fixture', 'CAMPUS_WORK', 'Errand', 'errand')
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
          table: 'ResourceTag',
          tagId: 'tag-resource',
        },
        {
          contentColumn: 'marketplaceItemId',
          contentId: 'marketplace-fixture',
          contentTable: 'MarketplaceItem',
          table: 'MarketplaceTag',
          tagId: 'tag-marketplace',
        },
        {
          contentColumn: 'campusWorkPostId',
          contentId: 'job-alpha',
          contentTable: 'CampusWorkPost',
          table: 'CampusWorkTag',
          tagId: 'tag-campus-work',
        },
      ]) {
        const insert = `
          INSERT INTO "${join.table}" ("${join.contentColumn}", "tagId")
          VALUES ('${join.contentId}', '${join.tagId}')
        `;
        await migrationClient.query(insert);
        await expect(migrationClient.query(insert)).rejects.toMatchObject({
          code: '23505',
        });
        await expect(
          migrationClient.query(`
            INSERT INTO "${join.table}" ("${join.contentColumn}", "tagId")
            VALUES ('${join.contentId}', 'missing-tag')
          `),
        ).rejects.toMatchObject({ code: '23503' });
        await expect(
          migrationClient.query(`
            INSERT INTO "${join.table}" ("${join.contentColumn}", "tagId")
            VALUES ('missing-content', '${join.tagId}')
          `),
        ).rejects.toMatchObject({ code: '23503' });
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
});
