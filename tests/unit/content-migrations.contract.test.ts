import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function migration(path: string) {
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
