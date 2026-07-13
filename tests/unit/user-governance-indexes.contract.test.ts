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

  it('uses non-transactional concurrent DDL and retries only its own indexes', () => {
    expect(migration).not.toBe('');
    const statements = migration
      .split(';')
      .map((statement) => statement.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    expect(statements).toEqual([
      'CREATE EXTENSION IF NOT EXISTS pg_trgm',
      'DROP INDEX CONCURRENTLY IF EXISTS "User_campus_createdAt_id_idx"',
      'DROP INDEX CONCURRENTLY IF EXISTS "User_name_trgm_idx"',
      'DROP INDEX CONCURRENTLY IF EXISTS "User_email_trgm_idx"',
      'CREATE INDEX CONCURRENTLY "User_campus_createdAt_id_idx" ON "User" ("campusId", "createdAt" DESC, "id" DESC)',
      'CREATE INDEX CONCURRENTLY "User_name_trgm_idx" ON "User" USING GIN ("name" gin_trgm_ops)',
      'CREATE INDEX CONCURRENTLY "User_email_trgm_idx" ON "User" USING GIN ("email" gin_trgm_ops)',
    ]);
    expect(migration).not.toMatch(/\b(?:BEGIN|COMMIT)\b/i);
  });

  it('documents that the production migration role must create pg_trgm', () => {
    expect(deliveryGuide).toMatch(
      /数据库迁移账号[^。\n]*pg_trgm[^。\n]*CREATE EXTENSION/i,
    );
  });

  it('documents online execution and bounded retry recovery', () => {
    expect(deliveryGuide).toContain(
      '`20260713180000_add_user_governance_indexes` 必须保持非事务',
    );
    expect(deliveryGuide).toContain('CREATE INDEX CONCURRENTLY');
    expect(deliveryGuide).toContain('`INSERT`、`UPDATE`、`DELETE`');
    expect(deliveryGuide).toContain('磁盘与 I/O');
    expect(deliveryGuide).toContain('确认没有仍在运行的 create-index 进程');
    expect(deliveryGuide).toContain(
      'prisma migrate resolve --rolled-back 20260713180000_add_user_governance_indexes',
    );
    expect(deliveryGuide).toContain(
      '只会清理它自己的三个 partial/invalid 索引',
    );
    for (const name of [
      'User_campus_createdAt_id_idx',
      'User_name_trgm_idx',
      'User_email_trgm_idx',
    ]) {
      expect(deliveryGuide).toContain(name);
    }
    expect(deliveryGuide).toContain('不得在生产手工删除其他索引');
  });
});
