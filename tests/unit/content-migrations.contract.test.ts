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
const contractMigrationPath = fileURLToPath(
  new URL(
    '../../prisma/migrations/20260713220000_contract_legacy_content/migration.sql',
    import.meta.url,
  ),
);
const contractMigration = existsSync(contractMigrationPath)
  ? readFileSync(contractMigrationPath, 'utf8')
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

function sqlForeignKeyConstraint(table: string, constraint: string) {
  const match = tagsMigration.match(
    new RegExp(
      `ALTER TABLE "${table}"\\s+ADD CONSTRAINT "${constraint}"\\s+FOREIGN KEY \\(([^)]+)\\)\\s+REFERENCES "([^"]+)"\\(([^)]+)\\)\\s+ON DELETE (CASCADE|RESTRICT|SET NULL) ON UPDATE (CASCADE|RESTRICT|SET NULL)`,
      'i',
    ),
  );

  return {
    columns: [...(match?.[1] ?? '').matchAll(/"([^"]+)"/g)].map(
      (column) => column[1],
    ),
    onDelete: match?.[4] ?? '',
    onUpdate: match?.[5] ?? '',
    referencedColumns: [...(match?.[3] ?? '').matchAll(/"([^"]+)"/g)].map(
      (column) => column[1],
    ),
    referencedTable: match?.[2] ?? '',
  };
}

function sqlCheckConstraint(table: string, constraint: string) {
  return (
    tagsMigration.match(
      new RegExp(
        `ALTER TABLE "${table}"\\s+ADD CONSTRAINT "${constraint}"\\s+CHECK \\(([^;]+)\\);`,
        'i',
      ),
    )?.[1] ?? ''
  ).trim();
}

function sqlFunction(name: string) {
  return (
    tagsMigration.match(
      new RegExp(
        `CREATE FUNCTION "${name}"\\(\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`,
      ),
    )?.[1] ?? ''
  );
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
  it('wraps every migration operation in one explicit transaction', () => {
    const effectiveSql = tagsMigration.replace(/^\s*--.*$/gm, '').trim();

    expect(effectiveSql).toMatch(/^BEGIN;\s/);
    expect(effectiveSql).toMatch(/COMMIT;$/);
    expect(effectiveSql.match(/\bBEGIN;/g)).toHaveLength(1);
    expect(effectiveSql.match(/\bCOMMIT;/g)).toHaveLength(1);
  });

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
    expect(tagDefinition).toContain('@@unique([id, campusId, scope])');
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
    expect(sqlIndex('TagDefinition_id_campusId_scope_key')).toStrictEqual({
      columns: ['id', 'campusId', 'scope'],
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
        expectedScope: 'RESOURCE',
        index: 'ResourceTag_tagId_resourceId_idx',
        model: 'ResourceTag',
      },
      {
        contentColumn: 'marketplaceItemId',
        contentModel: 'MarketplaceItem',
        expectedScope: 'MARKETPLACE',
        index: 'MarketplaceTag_tagId_marketplaceItemId_idx',
        model: 'MarketplaceTag',
      },
      {
        contentColumn: 'campusWorkPostId',
        contentModel: 'CampusWorkPost',
        expectedScope: 'CAMPUS_WORK',
        index: 'CampusWorkTag_tagId_campusWorkPostId_idx',
        model: 'CampusWorkTag',
      },
    ]) {
      const joinModel = prismaBlock('model', join.model);
      expect(joinModel).toContain(`@@id([${join.contentColumn}, tagId])`);
      expect(joinModel).toContain(`@@index([tagId, ${join.contentColumn}])`);
      expect(joinModel).toMatch(/campusId\s+String/);
      expect(joinModel).toMatch(
        new RegExp(`scope\\s+TagScope\\s+@default\\(${join.expectedScope}\\)`),
      );
      expect(joinModel).toMatch(
        /tag\s+TagDefinition\s+@relation\(fields: \[tagId, campusId, scope\], references: \[id, campusId, scope\], onDelete: Restrict\)/,
      );
      expect(sqlColumn(join.model, join.contentColumn)).toBe('TEXT NOT NULL');
      expect(sqlColumn(join.model, 'tagId')).toBe('TEXT NOT NULL');
      expect(sqlColumn(join.model, 'campusId')).toBe('TEXT NOT NULL');
      expect(sqlColumn(join.model, 'scope')).toBe(
        `"TagScope" NOT NULL DEFAULT '${join.expectedScope}'`,
      );
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
      expect(
        sqlForeignKeyConstraint(join.model, `${join.model}_tagId_fkey`),
      ).toStrictEqual({
        columns: ['tagId', 'campusId', 'scope'],
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        referencedColumns: ['id', 'campusId', 'scope'],
        referencedTable: 'TagDefinition',
      });
      expect(sqlCheckConstraint(join.model, `${join.model}_scope_check`)).toBe(
        `"scope" = '${join.expectedScope}'::"TagScope"`,
      );
      expect(sqlIndex(join.index)).toStrictEqual({
        columns: ['tagId', join.contentColumn],
        table: join.model,
        unique: false,
      });
    }
  });

  it('enforces join campus equality and protects tagged parent campus updates', () => {
    const validator = sqlFunction('_validate_tag_join_campus');
    const parentProtector = sqlFunction('_protect_tagged_content_campus');

    expect(validator).toMatch(/to_jsonb\(NEW\)/);
    expect(validator).toMatch(/FOR SHARE/);
    expect(validator).toMatch(/TG_TABLE_SCHEMA/);
    expect(parentProtector).toMatch(/TG_TABLE_SCHEMA/);
    expect(parentProtector).toMatch(/to_jsonb\(NEW\)/);
    for (const [join, parent] of [
      ['ResourceTag', 'Resource'],
      ['MarketplaceTag', 'MarketplaceItem'],
      ['CampusWorkTag', 'CampusWorkPost'],
    ]) {
      expect(tagsMigration).toMatch(
        new RegExp(
          `CREATE TRIGGER "${join}_campus_guard"[\\s\\S]*BEFORE INSERT OR UPDATE ON "${join}"[\\s\\S]*EXECUTE FUNCTION "_validate_tag_join_campus"`,
        ),
      );
      expect(tagsMigration).toMatch(
        new RegExp(
          `CREATE TRIGGER "${parent}_tagged_campus_guard"[\\s\\S]*BEFORE UPDATE OF "campusId" ON "${parent}"[\\s\\S]*EXECUTE FUNCTION "_protect_tagged_content_campus"`,
        ),
      );
    }
  });

  it('matches Prisma CampusWorkPost nullability, defaults, keys, and indexes', () => {
    const campusWork = prismaBlock('model', 'CampusWorkPost');

    expect(campusWork).not.toContain('company');
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

  it('locks legacy writers and installs a safe sync bridge before backfill', () => {
    const lockIndex = tagsMigration.indexOf(
      'LOCK TABLE "JobPost" IN SHARE ROW EXCLUSIVE MODE',
    );
    const triggerIndex = tagsMigration.indexOf(
      'CREATE TRIGGER "JobPost_campus_work_sync"',
    );
    const backfillIndex = tagsMigration.indexOf('INSERT INTO "CampusWorkPost"');
    const syncFunction = sqlFunction('_sync_job_post_to_campus_work');

    expect(lockIndex).toBeGreaterThan(-1);
    expect(triggerIndex).toBeGreaterThan(lockIndex);
    expect(backfillIndex).toBeGreaterThan(triggerIndex);
    expect(tagsMigration).toMatch(
      /CREATE TRIGGER "JobPost_campus_work_sync"[\s\S]*AFTER INSERT OR UPDATE OR DELETE ON "JobPost"/,
    );
    expect(tagsMigration).toMatch(/SECURITY INVOKER/);
    expect(tagsMigration).toMatch(/SET search_path = pg_catalog/);
    expect(syncFunction).toMatch(/TG_TABLE_SCHEMA/);
    expect(syncFunction).toMatch(/format\(/);
    expect(syncFunction).toMatch(/%I/);
    expect(syncFunction).toMatch(/USING/);
    expect(syncFunction).toMatch(/TG_OP = 'DELETE'/);
    expect(syncFunction).toMatch(/ON CONFLICT \("id"\) DO UPDATE/);
    expect(syncFunction).not.toMatch(/UPDATE SET[\s\S]*"contact"\s*=/);
  });

  it('requires post-migration legacy writes and a real rollback probe', () => {
    expect(integrationSchemaSource).toContain(
      'verifies the legacy JobPost sync bridge',
    );
    expect(integrationSchemaSource).toMatch(
      /UPDATE "CampusWorkPost"[\s\S]*"contact"[\s\S]*UPDATE "JobPost"/,
    );
    expect(integrationSchemaSource).toMatch(
      /INSERT INTO "JobPost"[\s\S]*DELETE FROM "JobPost"/,
    );
    expect(integrationSchemaSource).toContain(
      'rolls back every migration object on a controlled failure',
    );
    expect(integrationSchemaSource).toContain('forced migration rollback');
    expect(integrationSchemaSource).toMatch(/ROLLBACK/);
    expect(integrationSchemaSource).toMatch(/to_regtype/);
    expect(integrationSchemaSource).toMatch(/to_regclass/);
  });

  it('documents the short JobPost write lock and Phase 5 bridge lifetime', () => {
    expect(phasePlans[0]).toContain('SHARE ROW EXCLUSIVE');
    expect(phasePlans[0]).toMatch(/sync trigger[\s\S]*Phase 5/i);
  });
});

describe('legacy content contract migration', () => {
  it('exists after the expand migrations and is one explicit transaction', () => {
    expect(existsSync(contractMigrationPath)).toBe(true);
    const effectiveSql = contractMigration.replace(/^\s*--.*$/gm, '').trim();
    expect(effectiveSql).toMatch(/^BEGIN;\s/);
    expect(effectiveSql).toMatch(/COMMIT;$/);
    expect(effectiveSql.match(/\bBEGIN;/g)).toHaveLength(1);
    expect(effectiveSql.match(/\bCOMMIT;/g)).toHaveLength(1);
  });

  it('verifies the complete legacy copy before removing compatibility storage', () => {
    const guardIndex = contractMigration.indexOf('legacy_count');
    const dropIndex = contractMigration.indexOf('DROP TABLE "JobPost"');

    expect(guardIndex).toBeGreaterThan(-1);
    expect(dropIndex).toBeGreaterThan(guardIndex);
    expect(contractMigration).toMatch(
      /SELECT COUNT\(\*\) INTO legacy_count FROM "JobPost"/,
    );
    expect(contractMigration).toMatch(
      /SELECT COUNT\(\*\) INTO campus_work_count\s+FROM "CampusWorkPost"/,
    );
    for (const field of [
      'authorId',
      'campusId',
      'title',
      'description',
      'location',
      'payText',
      'status',
      'createdAt',
      'updatedAt',
    ]) {
      expect(contractMigration).toMatch(
        new RegExp(
          `target\\."${field}"\\s+IS DISTINCT FROM\\s+source\\."${field}"`,
        ),
      );
    }
    expect(contractMigration).toMatch(
      /FROM "CampusWorkPost"[\s\S]*"authorId" IS NULL[\s\S]*"updatedAt" IS NULL/,
    );
    expect(contractMigration).toMatch(/RAISE EXCEPTION[\s\S]*row count/i);
    expect(contractMigration).toMatch(/RAISE EXCEPTION[\s\S]*field mismatch/i);
    expect(contractMigration).toMatch(/RAISE EXCEPTION[\s\S]*required field/i);
  });

  it('drops only the approved legacy bridge, table, and columns after guards', () => {
    const guardIndex = contractMigration.indexOf('legacy_count');
    for (const operation of [
      'DROP TRIGGER "JobPost_campus_work_sync" ON "JobPost"',
      'DROP FUNCTION "_sync_job_post_to_campus_work"()',
      'DROP TABLE "JobPost"',
      'ALTER TABLE "Resource" DROP COLUMN "courseCode"',
      'ALTER TABLE "Campus" DROP COLUMN "allowedEmailDomain"',
      'ALTER TABLE "CampusWorkPost" DROP COLUMN "company"',
    ]) {
      expect(contractMigration, operation).toContain(operation);
      expect(contractMigration.indexOf(operation), operation).toBeGreaterThan(
        guardIndex,
      );
    }
    expect(contractMigration).not.toMatch(/DROP TABLE "CampusWorkPost"/);
    expect(contractMigration).not.toMatch(/DROP TABLE "Resource"/);
    expect(contractMigration).not.toMatch(/DROP TABLE "Campus"/);
  });

  it('matches the contracted Prisma schema', () => {
    expect(prismaBlock('model', 'Resource')).not.toContain('courseCode');
    expect(prismaBlock('model', 'Campus')).not.toContain('allowedEmailDomain');
    expect(prismaBlock('model', 'Campus')).not.toContain('jobPosts');
    expect(prismaBlock('model', 'User')).not.toContain('jobPosts');
    expect(prismaBlock('model', 'CampusWorkPost')).not.toContain('company');
    expect(schema).not.toMatch(/model JobPost\s*\{/);
  });
});
