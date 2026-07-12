import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)),
  'utf8',
);

describe('engagement persistence contract', () => {
  it('uses a strict report reason enum', () => {
    expect(schema).toMatch(
      /enum ReportReason\s*\{[\s\S]*?SPAM[\s\S]*?MISLEADING[\s\S]*?HARASSMENT[\s\S]*?PROHIBITED[\s\S]*?OTHER/,
    );
    expect(schema).toMatch(/model Report\s*\{[\s\S]*?reason\s+ReportReason/);
  });

  it('enforces one OPEN report per reporter and target with a partial unique index', () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          '../../prisma/migrations/20260712044000_init/migration.sql',
          import.meta.url,
        ),
      ),
      'utf8',
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "Report_one_open_per_reporter_target_key"[\s\S]*"reporterId"[\s\S]*"targetType"[\s\S]*"targetId"[\s\S]*WHERE "status" = 'OPEN'/i,
    );
  });
});
