import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  blockedWordDefaults,
  presetTagDefaults,
} from '@/prisma/default-content-data';

const migration = readFileSync(
  new URL(
    '../../prisma/migrations/20260717100000_seed_publishing_defaults/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('production publishing defaults', () => {
  it('defines unique preset slugs for all content scopes', () => {
    const keys = presetTagDefaults.map((item) => `${item.scope}:${item.slug}`);

    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(presetTagDefaults.map((item) => item.scope))).toEqual(
      new Set(['RESOURCE', 'MARKETPLACE', 'CAMPUS_WORK']),
    );
    expect(
      presetTagDefaults.every(
        (item) => item.label.trim() === item.label && item.label.length > 0,
      ),
    ).toBe(true);
  });

  it('defines conservative categorized blocked words', () => {
    expect(blockedWordDefaults.length).toBeGreaterThan(0);
    expect(
      new Set(blockedWordDefaults.map((item) => item.normalized)).size,
    ).toBe(blockedWordDefaults.length);
    expect(
      blockedWordDefaults.every(
        (item) =>
          item.category.length > 0 &&
          item.original.length > 0 &&
          item.normalized.length > 0 &&
          item.reason.length >= 5,
      ),
    ).toBe(true);
  });

  it('seeds active campuses without overwriting administrator choices', () => {
    expect(migration).toContain('FROM "Campus"');
    expect(migration).toContain('WHERE campus."isActive" = true');
    expect(migration).toContain('ON CONFLICT DO NOTHING');
    expect(migration).not.toMatch(/ON CONFLICT[\s\S]*DO UPDATE/i);
    expect(migration).not.toMatch(/\bDELETE\b|\bTRUNCATE\b/i);
  });
});
