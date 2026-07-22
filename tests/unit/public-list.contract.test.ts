import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(
    new URL('../../components/content/public-list.tsx', import.meta.url),
  ),
  'utf8',
);
const styles = readFileSync(
  fileURLToPath(new URL('../../app/globals.css', import.meta.url)),
  'utf8',
);

describe('public content list filter contract', () => {
  it('renders the marketplace filters as a dedicated two-column group', () => {
    const marketplaceFilters = source.match(
      /\{kind === 'marketplace'[\s\S]*?\) : null\}/,
    )?.[0];

    expect(marketplaceFilters).toBeDefined();
    expect(source).toContain('filter-row marketplace-filter-row');
    expect(marketplaceFilters).toMatch(/name="condition"[\s\S]*name="tag"/);
    expect(marketplaceFilters).toMatch(/name="tag"[\s\S]*name="minPrice"/);
    expect(marketplaceFilters).toMatch(/name="minPrice"[\s\S]*name="maxPrice"/);
    expect(marketplaceFilters).toContain('最低价（元）');
    expect(marketplaceFilters).toContain('最高价（元）');
    expect(marketplaceFilters?.match(/inputMode="decimal"/g)).toHaveLength(2);
    expect(marketplaceFilters).toMatch(
      /<select(?=[^>]*aria-label="商品状态")(?=[^>]*name="condition")[^>]*>/,
    );
    expect(marketplaceFilters).toMatch(
      /<input(?=[^>]*aria-label="标签")(?=[^>]*name="tag")(?=[^>]*placeholder="标签")[^>]*\/>/,
    );
    expect(marketplaceFilters).toMatch(
      /<input(?=[^>]*aria-label="最低价（元）")(?=[^>]*name="minPrice")(?=[^>]*placeholder="最低价（元）")[^>]*\/>/,
    );
    expect(marketplaceFilters).toMatch(
      /<input(?=[^>]*aria-label="最高价（元）")(?=[^>]*name="maxPrice")(?=[^>]*placeholder="最高价（元）")[^>]*\/>/,
    );
    expect(source).not.toMatch(/name="(?:minPriceCents|maxPriceCents)"/);
    expect(styles).toMatch(
      /\.search-form \.filter-row\.marketplace-filter-row\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(styles).toMatch(
      /\.search-form \.marketplace-filter-row input,[\s\S]*?\.search-form \.marketplace-filter-row select\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/,
    );
  });

  it('exposes filter validation errors to assistive technology', () => {
    expect(source).toMatch(/role="alert"/);
  });
});
