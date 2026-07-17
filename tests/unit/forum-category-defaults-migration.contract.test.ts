import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../prisma/migrations/20260718100000_seed_forum_categories/migration.sql',
    import.meta.url,
  ),
);
const migrationSql = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';

describe('forum category defaults migration contract', () => {
  it('runs inside an explicit transaction for every campus', () => {
    expect(migrationSql.trimStart()).toMatch(/^BEGIN;/);
    expect(migrationSql.trimEnd()).toMatch(/COMMIT;$/);
    expect(migrationSql).toContain('FROM "Campus" AS campus');
  });

  it('defines the seven shared forum categories', () => {
    const defaults = [
      ['campus-life', '校园生活'],
      ['study-help', '学习互助'],
      ['lost-and-found', '失物招领'],
      ['interests', '兴趣交流'],
      ['help-and-advice', '求助建议'],
      ['emotional-support', '情感交流'],
      ['other', '其他'],
    ] as const;

    for (const [slug, label] of defaults) {
      expect(migrationSql).toContain(`('${slug}', '${label}')`);
    }
  });

  it('preserves existing administrator governance', () => {
    expect(migrationSql).toContain(
      'ON CONFLICT ("campusId", "slug") DO NOTHING',
    );
    expect(migrationSql).not.toMatch(
      /\b(?:DELETE|DROP|TRUNCATE)\b|\bDO\s+UPDATE\b/i,
    );
  });
});
