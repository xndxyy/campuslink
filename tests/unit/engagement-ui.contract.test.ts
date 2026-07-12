import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(
    new URL('../../components/content/engagement-actions.tsx', import.meta.url),
  ),
  'utf8',
);

describe('published detail engagement UI', () => {
  it('provides accessible favourite, report dialog, and contact controls', () => {
    expect(source).toContain('aria-pressed');
    expect(source).toContain('<dialog');
    expect(source).toContain('aria-labelledby');
    expect(source).toContain('Request contact');
    expect(source).toContain('Owner listing');
  });

  it('keeps revealed contact ephemeral', () => {
    expect(source).not.toMatch(/localStorage|sessionStorage/);
    expect(source).not.toMatch(/URLSearchParams|history\.pushState/);
    expect(source).toMatch(/useState<string \| null>\(null\)/);
  });

  it('sends only strict target identity and report fields', () => {
    expect(source).not.toMatch(/userId\s*:/);
    expect(source).not.toMatch(/ownerId\s*:/);
    expect(source).not.toMatch(/assigneeId\s*:/);
    expect(source).toContain("'/api/favourites'");
    expect(source).toContain("'/api/reports'");
  });
});
