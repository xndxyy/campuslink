import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../e2e/publish-content.spec.ts', import.meta.url)),
  'utf8',
);

describe('publish content live E2E navigation contract', () => {
  it('waits for the submissions list pathname rather than matching the edit URL', () => {
    expect(source).toMatch(
      /toHaveURL\(\s*\(url\)\s*=>\s*url\.pathname\s*===\s*['"]\/me\/submissions['"]\s*,?\s*\)/,
    );
    expect(source).not.toContain('toHaveURL(/me\\/submissions/)');
  });
});
