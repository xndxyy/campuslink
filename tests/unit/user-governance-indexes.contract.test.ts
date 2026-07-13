import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)),
  'utf8',
);
const migrationPath = fileURLToPath(
  new URL(
    '../../prisma/migrations/20260713180000_add_user_governance_indexes/migration.sql',
    import.meta.url,
  ),
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';
const deliveryGuide = readFileSync(
  fileURLToPath(
    new URL(
      '../../docs/CAMPUSLINK_PROJECT_DELIVERY_GUIDE_ZH.md',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('user governance index contract', () => {
  it('declares stable pagination and trigram indexes in Prisma schema', () => {
    expect(schema).toContain(
      '@@index([campusId, createdAt(sort: Desc), id(sort: Desc)], map: "User_campus_createdAt_id_idx")',
    );
    expect(schema).toContain(
      '@@index([name(ops: raw("gin_trgm_ops"))], type: Gin, map: "User_name_trgm_idx")',
    );
    expect(schema).toContain(
      '@@index([email(ops: raw("gin_trgm_ops"))], type: Gin, map: "User_email_trgm_idx")',
    );
  });

  it('adds only pg_trgm and fixed-name indexes in an expand-only migration', () => {
    expect(migration).not.toBe('');
    expect(migration).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm;/i);
    expect(migration).toMatch(
      /CREATE INDEX IF NOT EXISTS "User_campus_createdAt_id_idx"[\s\S]*ON "User" \("campusId", "createdAt" DESC, "id" DESC\);/i,
    );
    for (const [name, column] of [
      ['User_name_trgm_idx', 'name'],
      ['User_email_trgm_idx', 'email'],
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `CREATE INDEX IF NOT EXISTS "${name}"[\\s\\S]*ON "User" USING GIN \\("${column}" gin_trgm_ops\\);`,
          'i',
        ),
      );
    }
    expect(migration).not.toMatch(/\b(?:DROP|DELETE|UPDATE|TRUNCATE)\b/i);
    expect(migration).not.toMatch(/ALTER\s+TABLE/i);
  });

  it('documents that the production migration role must create pg_trgm', () => {
    expect(deliveryGuide).toMatch(
      /数据库迁移账号[^。\n]*pg_trgm[^。\n]*CREATE EXTENSION/i,
    );
  });
});
