import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(
    new URL('../../components/content/public-list.tsx', import.meta.url),
  ),
  'utf8',
);

describe('public content list filter contract', () => {
  it('preserves the marketplace tag filter in the query form', () => {
    const marketplaceFilters = source.match(
      /\{kind === 'marketplace'[\s\S]*?\) : null\}/,
    )?.[0];

    expect(marketplaceFilters).toBeDefined();
    expect(marketplaceFilters).toMatch(
      /<input\s+defaultValue=\{query\.tag\}\s+name="tag"\s+placeholder="标签"\s*\/>/,
    );
  });
});
