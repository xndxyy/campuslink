import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../prisma/migrations/20260713193000_add_campus_work_search_indexes/migration.sql',
    import.meta.url,
  ),
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';
const priorSearchMigration = readFileSync(
  fileURLToPath(
    new URL(
      '../../prisma/migrations/20260712183000_add_content_search_indexes/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('CampusWork public search indexes', () => {
  it('uses the next phase-three migration without a transaction wrapper', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(migration).not.toMatch(/\bBEGIN\s*;/i);
    expect(migration).not.toMatch(/\bCOMMIT\s*;/i);
    expect(migration).not.toMatch(/CREATE EXTENSION/i);
    expect(priorSearchMigration).toMatch(
      /CREATE EXTENSION IF NOT EXISTS pg_trgm/i,
    );
  });

  it('recreates each stable GIN trigram index after dropping invalid retries', () => {
    for (const field of ['title', 'description', 'location', 'payText']) {
      const indexName = `CampusWorkPost_${field}_trgm_idx`;
      expect(migration).toMatch(
        new RegExp(
          `DROP INDEX CONCURRENTLY IF EXISTS "${indexName}";\\s*` +
            `CREATE INDEX CONCURRENTLY "${indexName}"\\s*` +
            `ON "CampusWorkPost" USING GIN \\(\\"${field}\\" gin_trgm_ops\\);`,
        ),
      );
    }
    expect(migration.match(/DROP INDEX CONCURRENTLY IF EXISTS/g)).toHaveLength(
      4,
    );
    expect(migration.match(/CREATE INDEX CONCURRENTLY /g)).toHaveLength(4);
    expect(migration).not.toMatch(/CREATE INDEX CONCURRENTLY IF NOT EXISTS/i);
  });
});
