import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(
  fileURLToPath(new URL('../../app/layout.tsx', import.meta.url)),
  'utf8',
);

describe('application layout contract', () => {
  it('declares the smooth scroll behavior used during route transitions', () => {
    expect(layout).toContain('data-scroll-behavior="smooth"');
  });
});
