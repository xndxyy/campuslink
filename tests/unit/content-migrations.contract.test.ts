import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function migration(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

const tagsMigrationPath = fileURLToPath(
  new URL(
    '../../prisma/migrations/20260713190000_add_tags_and_campus_work/migration.sql',
    import.meta.url,
  ),
);
const tagsMigration = existsSync(tagsMigrationPath)
  ? readFileSync(tagsMigrationPath, 'utf8')
  : '';

function plan(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

describe('marketplace condition migration', () => {
  const sql = migration(
    '../../prisma/migrations/20260712170000_typed_marketplace_content/migration.sql',
  );

  it('maps supported legacy values without silently coercing unknown data', () => {
    expect(sql).toMatch(/'excellent'[\s\S]*?'LIKE_NEW'/i);
    expect(sql).toMatch(/'unopened'[\s\S]*?'NEW'/i);
    expect(sql).toMatch(/'poor'[\s\S]*?'POOR'/i);
    expect(sql).toMatch(/RAISE EXCEPTION/i);
    expect(sql).not.toMatch(/ELSE\s+'GOOD'/i);
  });
});

describe('public discovery trigram migration', () => {
  const sql = migration(
    '../../prisma/migrations/20260712183000_add_content_search_indexes/migration.sql',
  );

  it('creates pg_trgm and idempotent GIN indexes for every substring field', () => {
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm/i);
    for (const [model, field] of [
      ['Resource', 'title'],
      ['Resource', 'summary'],
      ['Resource', 'courseCode'],
      ['MarketplaceItem', 'title'],
      ['MarketplaceItem', 'description'],
      ['MarketplaceItem', 'pickupArea'],
      ['JobPost', 'title'],
      ['JobPost', 'company'],
      ['JobPost', 'description'],
      ['JobPost', 'location'],
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `CREATE INDEX IF NOT EXISTS[\\s\\S]*ON "${model}"[\\s\\S]*"${field}" gin_trgm_ops`,
          'i',
        ),
      );
    }
  });
});

describe('scoped tags and campus-work expand migration', () => {
  it('uses the first migration number after the published phase-two migration', () => {
    expect(existsSync(tagsMigrationPath)).toBe(true);

    const migrationDirectories = readdirSync(
      fileURLToPath(new URL('../../prisma/migrations', import.meta.url)),
      { withFileTypes: true },
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(migrationDirectories).toContain(
      '20260713180000_add_user_governance_indexes',
    );
    expect(migrationDirectories).toContain(
      '20260713190000_add_tags_and_campus_work',
    );
    expect(new Set(migrationDirectories).size).toBe(
      migrationDirectories.length,
    );
    expect(
      migrationDirectories.indexOf('20260713190000_add_tags_and_campus_work'),
    ).toBeGreaterThan(
      migrationDirectories.indexOf(
        '20260713180000_add_user_governance_indexes',
      ),
    );
  });

  it('reserves unique monotonically increasing paths in future plans', () => {
    const publishingPlan = plan(
      '../../docs/superpowers/plans/2026-07-13-campuslink-publishing-tags-campus-work.md',
    );
    const forumPlan = plan(
      '../../docs/superpowers/plans/2026-07-13-campuslink-forum-treehole.md',
    );
    const aiPlan = plan(
      '../../docs/superpowers/plans/2026-07-13-campuslink-ai-moderation-release.md',
    );
    const plannedMigrations = [
      '20260713190000_add_tags_and_campus_work',
      '20260713200000_add_forum',
      '20260713210000_add_content_assessment',
      '20260713220000_contract_legacy_content',
    ];

    expect(publishingPlan).toContain(plannedMigrations[0]);
    expect(forumPlan).toContain(plannedMigrations[1]);
    expect(aiPlan).toContain(plannedMigrations[2]);
    expect(aiPlan).toContain(plannedMigrations[3]);
    expect(new Set(plannedMigrations).size).toBe(plannedMigrations.length);
  });

  it('creates scoped tag tables and indexed explicit joins', () => {
    expect(tagsMigration).toMatch(
      /CREATE TYPE "TagScope" AS ENUM \('RESOURCE', 'MARKETPLACE', 'CAMPUS_WORK'\)/,
    );
    for (const table of [
      'TagDefinition',
      'ResourceTag',
      'MarketplaceTag',
      'CampusWorkTag',
      'CampusWorkPost',
    ]) {
      expect(tagsMigration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(tagsMigration).toContain(
      'CREATE UNIQUE INDEX "TagDefinition_campusId_scope_slug_key"',
    );
    expect(tagsMigration).toContain(
      'CREATE INDEX "TagDefinition_campusId_scope_isActive_label_idx"',
    );
    for (const index of [
      'ResourceTag_tagId_resourceId_idx',
      'MarketplaceTag_tagId_marketplaceItemId_idx',
      'CampusWorkTag_tagId_campusWorkPostId_idx',
    ]) {
      expect(tagsMigration).toContain(`CREATE INDEX "${index}"`);
    }
  });

  it('copies every JobPost field losslessly and initializes contact to null', () => {
    expect(tagsMigration).toMatch(
      /INSERT INTO "CampusWorkPost"\s*\(\s*"id",\s*"authorId",\s*"campusId",\s*"company",\s*"title",\s*"description",\s*"location",\s*"payText",\s*"contact",\s*"status",\s*"createdAt",\s*"updatedAt"\s*\)\s*SELECT\s+source\."id",\s*source\."authorId",\s*source\."campusId",\s*source\."company",\s*source\."title",\s*source\."description",\s*source\."location",\s*source\."payText",\s*NULL(?:::TEXT)?,\s*source\."status",\s*source\."createdAt",\s*source\."updatedAt"\s+FROM "JobPost" AS source/,
    );
  });

  it('aborts on row-count or field mismatches after the copy', () => {
    expect(tagsMigration).toMatch(/SELECT COUNT\(\*\)[\s\S]*FROM "JobPost"/i);
    expect(tagsMigration).toMatch(
      /SELECT COUNT\(\*\)[\s\S]*FROM "CampusWorkPost"/i,
    );
    expect(tagsMigration).toMatch(/RAISE EXCEPTION[\s\S]*row count/i);
    for (const field of [
      'authorId',
      'campusId',
      'company',
      'title',
      'description',
      'location',
      'payText',
      'status',
      'createdAt',
      'updatedAt',
    ]) {
      expect(tagsMigration).toMatch(
        new RegExp(
          `target\\."${field}"\\s+IS DISTINCT FROM\\s+source\\."${field}"`,
        ),
      );
    }
    expect(tagsMigration).toMatch(/target\."contact" IS NOT NULL/);
    expect(tagsMigration).toMatch(/RAISE EXCEPTION[\s\S]*field mismatch/i);
  });

  it('is expand-only and leaves all legacy structures untouched', () => {
    expect(tagsMigration).not.toMatch(/^\s*(?:DROP|TRUNCATE|DELETE)\b/im);
    expect(tagsMigration).not.toMatch(/ALTER TABLE "JobPost"/i);
    expect(tagsMigration).not.toMatch(
      /ALTER TABLE "(?:Resource|Campus)"[\s\S]*?(?:DROP|RENAME)/i,
    );
  });
});
