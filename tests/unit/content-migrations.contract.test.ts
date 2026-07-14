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
const schema = readFileSync(
  fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)),
  'utf8',
);
const integrationSchemaSource = readFileSync(
  fileURLToPath(
    new URL('../integration/schema-constraints.test.ts', import.meta.url),
  ),
  'utf8',
);

function plan(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

const phasePlans = [
  plan(
    '../../docs/superpowers/plans/2026-07-13-campuslink-publishing-tags-campus-work.md',
  ),
  plan('../../docs/superpowers/plans/2026-07-13-campuslink-forum-treehole.md'),
  plan(
    '../../docs/superpowers/plans/2026-07-13-campuslink-ai-moderation-release.md',
  ),
];

function plannedMigrationDirectories(plans: string[]) {
  const migrationPath =
    /prisma\/migrations\/([0-9]{14}_[a-z0-9_]+)\/migration\.sql/g;

  return plans.flatMap((source) =>
    [...source.matchAll(migrationPath)].map((match) => match[1]),
  );
}

function prismaBlock(kind: 'enum' | 'model', name: string) {
  return (
    schema.match(new RegExp(`${kind} ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ??
    ''
  );
}

function prismaEnumValues(name: string) {
  return prismaBlock('enum', name)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function sqlEnumValues(name: string) {
  const values = tagsMigration.match(
    new RegExp(`CREATE TYPE "${name}" AS ENUM \\(([^)]+)\\)`),
  )?.[1];

  return [...(values ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function sqlTable(name: string) {
  return (
    tagsMigration.match(
      new RegExp(`CREATE TABLE "${name}" \\(([\\s\\S]*?)\\n\\);`),
    )?.[1] ?? ''
  );
}

function sqlColumn(table: string, column: string) {
  const definition = sqlTable(table).match(
    new RegExp(`^\\s*"${column}"\\s+(.+?)\\s*,?\\s*$`, 'm'),
  )?.[1];

  return definition?.replace(/,$/, '') ?? '';
}

function sqlPrimaryKey(table: string) {
  const columns = sqlTable(table).match(/PRIMARY KEY \(([^)]+)\)/)?.[1] ?? '';
  return [...columns.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function sqlIndex(name: string) {
  const match = tagsMigration.match(
    new RegExp(
      `CREATE\\s+(UNIQUE\\s+)?INDEX "${name}"\\s+ON "([^"]+)"\\(([^;]+)\\);`,
      'i',
    ),
  );

  return {
    columns: [...(match?.[3] ?? '').matchAll(/"([^"]+)"/g)].map(
      (column) => column[1],
    ),
    table: match?.[2] ?? '',
    unique: Boolean(match?.[1]),
  };
}

function sqlForeignKey(table: string, column: string) {
  const match = tagsMigration.match(
    new RegExp(
      `ALTER TABLE "${table}"\\s+ADD CONSTRAINT "([^"]+)"\\s+FOREIGN KEY \\(\\"${column}\\"\\) REFERENCES "([^"]+)"\\("([^"]+)"\\)\\s+ON DELETE (CASCADE|RESTRICT|SET NULL) ON UPDATE (CASCADE|RESTRICT|SET NULL)`,
      'i',
    ),
  );

  return {
    constraint: match?.[1] ?? '',
    onDelete: match?.[4] ?? '',
    onUpdate: match?.[5] ?? '',
    referencedColumn: match?.[3] ?? '',
    referencedTable: match?.[2] ?? '',
  };
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

  it('parses every phase plan migration in exact global order', () => {
    const plannedMigrations = plannedMigrationDirectories(phasePlans);
    const expectedMigrations = [
      '20260713190000_add_tags_and_campus_work',
      '20260713200000_add_forum',
      '20260713210000_add_content_assessment',
      '20260713220000_contract_legacy_content',
    ];
    const timestamps = plannedMigrations.map((directory) =>
      Number(directory.slice(0, 14)),
    );

    expect(plannedMigrations).toStrictEqual(expectedMigrations);
    expect(new Set(plannedMigrations).size).toBe(plannedMigrations.length);
    expect(timestamps.every((timestamp) => timestamp > 20260713180000)).toBe(
      true,
    );
    expect(
      timestamps.every(
        (timestamp, index) => index === 0 || timestamp > timestamps[index - 1],
      ),
    ).toBe(true);
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

  it('rejects every destructive operation against a legacy table or column', () => {
    for (const table of [
      'JobPost',
      'Resource',
      'Campus',
      'User',
      'MarketplaceItem',
    ]) {
      for (const operation of [
        `ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(?:(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\\.)?"${table}"`,
        `UPDATE\\s+(?:ONLY\\s+)?(?:(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\\.)?"${table}"`,
        `DELETE\\s+FROM\\s+(?:ONLY\\s+)?(?:(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\\.)?"${table}"`,
        `(?:DROP|TRUNCATE|RENAME)\\b[^;]*"${table}"`,
      ]) {
        expect(tagsMigration).not.toMatch(new RegExp(operation, 'i'));
      }
    }
    expect(tagsMigration).not.toContain('"courseCode"');
    expect(tagsMigration).not.toContain('"allowedEmailDomain"');
  });

  it('matches the Prisma enum and TagDefinition structure', () => {
    const tagDefinition = prismaBlock('model', 'TagDefinition');

    expect(sqlEnumValues('TagScope')).toStrictEqual(
      prismaEnumValues('TagScope'),
    );
    expect(sqlEnumValues('TagScope')).toStrictEqual([
      'RESOURCE',
      'MARKETPLACE',
      'CAMPUS_WORK',
    ]);
    expect(tagDefinition).toMatch(/label\s+String\s+@db\.VarChar\(32\)/);
    expect(tagDefinition).toMatch(/slug\s+String\s+@db\.VarChar\(40\)/);
    expect(tagDefinition).toContain('@@unique([campusId, scope, slug])');
    expect(tagDefinition).toContain(
      '@@index([campusId, scope, isActive, label])',
    );
    expect(sqlColumn('TagDefinition', 'id')).toBe('TEXT NOT NULL');
    expect(sqlColumn('TagDefinition', 'campusId')).toBe('TEXT NOT NULL');
    expect(sqlColumn('TagDefinition', 'scope')).toBe('"TagScope" NOT NULL');
    expect(sqlColumn('TagDefinition', 'label')).toBe('VARCHAR(32) NOT NULL');
    expect(sqlColumn('TagDefinition', 'slug')).toBe('VARCHAR(40) NOT NULL');
    expect(sqlColumn('TagDefinition', 'isPreset')).toBe(
      'BOOLEAN NOT NULL DEFAULT false',
    );
    expect(sqlColumn('TagDefinition', 'isActive')).toBe(
      'BOOLEAN NOT NULL DEFAULT true',
    );
    expect(sqlColumn('TagDefinition', 'createdAt')).toBe(
      'TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    );
    expect(sqlPrimaryKey('TagDefinition')).toStrictEqual(['id']);
    expect(sqlIndex('TagDefinition_campusId_scope_slug_key')).toStrictEqual({
      columns: ['campusId', 'scope', 'slug'],
      table: 'TagDefinition',
      unique: true,
    });
    expect(
      sqlIndex('TagDefinition_campusId_scope_isActive_label_idx'),
    ).toStrictEqual({
      columns: ['campusId', 'scope', 'isActive', 'label'],
      table: 'TagDefinition',
      unique: false,
    });
    expect(sqlForeignKey('TagDefinition', 'campusId')).toStrictEqual({
      constraint: 'TagDefinition_campusId_fkey',
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      referencedColumn: 'id',
      referencedTable: 'Campus',
    });
  });

  it('matches Prisma composite joins, foreign keys, and reverse indexes', () => {
    for (const join of [
      {
        contentColumn: 'resourceId',
        contentModel: 'Resource',
        index: 'ResourceTag_tagId_resourceId_idx',
        model: 'ResourceTag',
      },
      {
        contentColumn: 'marketplaceItemId',
        contentModel: 'MarketplaceItem',
        index: 'MarketplaceTag_tagId_marketplaceItemId_idx',
        model: 'MarketplaceTag',
      },
      {
        contentColumn: 'campusWorkPostId',
        contentModel: 'CampusWorkPost',
        index: 'CampusWorkTag_tagId_campusWorkPostId_idx',
        model: 'CampusWorkTag',
      },
    ]) {
      const joinModel = prismaBlock('model', join.model);
      expect(joinModel).toContain(`@@id([${join.contentColumn}, tagId])`);
      expect(joinModel).toContain(`@@index([tagId, ${join.contentColumn}])`);
      expect(sqlColumn(join.model, join.contentColumn)).toBe('TEXT NOT NULL');
      expect(sqlColumn(join.model, 'tagId')).toBe('TEXT NOT NULL');
      expect(sqlPrimaryKey(join.model)).toStrictEqual([
        join.contentColumn,
        'tagId',
      ]);
      expect(sqlForeignKey(join.model, join.contentColumn)).toStrictEqual({
        constraint: `${join.model}_${join.contentColumn}_fkey`,
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        referencedColumn: 'id',
        referencedTable: join.contentModel,
      });
      expect(sqlForeignKey(join.model, 'tagId')).toStrictEqual({
        constraint: `${join.model}_tagId_fkey`,
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        referencedColumn: 'id',
        referencedTable: 'TagDefinition',
      });
      expect(sqlIndex(join.index)).toStrictEqual({
        columns: ['tagId', join.contentColumn],
        table: join.model,
        unique: false,
      });
    }
  });

  it('matches Prisma CampusWorkPost nullability, defaults, keys, and indexes', () => {
    const campusWork = prismaBlock('model', 'CampusWorkPost');

    expect(campusWork).toMatch(/company\s+String\?\s+@db\.VarChar\(200\)/);
    expect(campusWork).toMatch(/contact\s+String\?\s+@db\.Text/);
    expect(campusWork).toMatch(/status\s+ContentStatus\s+@default\(DRAFT\)/);
    expect(sqlColumn('CampusWorkPost', 'company')).toBe('VARCHAR(200)');
    expect(sqlColumn('CampusWorkPost', 'contact')).toBe('TEXT');
    expect(sqlColumn('CampusWorkPost', 'status')).toBe(
      '"ContentStatus" NOT NULL DEFAULT \'DRAFT\'',
    );
    for (const [column, definition] of [
      ['id', 'TEXT NOT NULL'],
      ['authorId', 'TEXT NOT NULL'],
      ['campusId', 'TEXT NOT NULL'],
      ['title', 'VARCHAR(200) NOT NULL'],
      ['description', 'TEXT NOT NULL'],
      ['location', 'VARCHAR(200) NOT NULL'],
      ['payText', 'VARCHAR(200) NOT NULL'],
      ['createdAt', 'TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP'],
      ['updatedAt', 'TIMESTAMP(3) NOT NULL'],
    ]) {
      expect(sqlColumn('CampusWorkPost', column)).toBe(definition);
    }
    expect(sqlPrimaryKey('CampusWorkPost')).toStrictEqual(['id']);
    expect(sqlForeignKey('CampusWorkPost', 'authorId')).toStrictEqual({
      constraint: 'CampusWorkPost_authorId_fkey',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
      referencedColumn: 'id',
      referencedTable: 'User',
    });
    expect(sqlForeignKey('CampusWorkPost', 'campusId')).toStrictEqual({
      constraint: 'CampusWorkPost_campusId_fkey',
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      referencedColumn: 'id',
      referencedTable: 'Campus',
    });
    expect(
      sqlIndex('CampusWorkPost_campusId_status_createdAt_id_idx'),
    ).toStrictEqual({
      columns: ['campusId', 'status', 'createdAt', 'id'],
      table: 'CampusWorkPost',
      unique: false,
    });
    expect(sqlIndex('CampusWorkPost_authorId_status_idx')).toStrictEqual({
      columns: ['authorId', 'status'],
      table: 'CampusWorkPost',
      unique: false,
    });
  });

  it('requires integration to build pre-migration fixtures and apply the real SQL', () => {
    const fixtureExecution = integrationSchemaSource.indexOf(
      'await migrationClient.query(legacyCampusWorkSchemaSql)',
    );
    const migrationExecution = integrationSchemaSource.indexOf(
      'await migrationClient.query(campusWorkMigrationSql)',
    );

    expect(integrationSchemaSource).toContain(
      '../../prisma/migrations/20260713190000_add_tags_and_campus_work/migration.sql',
    );
    expect(integrationSchemaSource).toMatch(/new Client\(/);
    expect(integrationSchemaSource).toMatch(/\(_test\|_e2e\)\$|_e2e\|_test/);
    expect(integrationSchemaSource).toContain(
      '/^campus_work_migration_[0-9a-f]{32}$/',
    );
    expect(integrationSchemaSource).toMatch(/CREATE SCHEMA/);
    expect(integrationSchemaSource).toMatch(/SET search_path/);
    expect(integrationSchemaSource).toMatch(/CREATE TYPE "ContentStatus"/);
    expect(integrationSchemaSource).toMatch(
      /INSERT INTO "JobPost"[\s\S]*VALUES[\s\S]*\),\s*\(/,
    );
    expect(integrationSchemaSource).toContain("'DRAFT'");
    expect(integrationSchemaSource).toContain("'PUBLISHED'");
    expect(fixtureExecution).toBeGreaterThan(-1);
    expect(migrationExecution).toBeGreaterThan(fixtureExecution);
    expect(integrationSchemaSource).toMatch(
      /finally[\s\S]*DROP SCHEMA[\s\S]*CASCADE/,
    );
    expect(integrationSchemaSource).toContain(
      '`DROP SCHEMA "${temporarySchema}" CASCADE`',
    );
    expect(integrationSchemaSource).not.toMatch(/(?:CREATE|DROP) DATABASE/i);
    expect(integrationSchemaSource).not.toMatch(
      /(?:CREATE|DROP|ALTER) SCHEMA "?public"?/i,
    );
    expect(integrationSchemaSource).not.toContain('_prisma_migrations');
    expect(integrationSchemaSource).not.toContain('finishedAt');
  });
});
