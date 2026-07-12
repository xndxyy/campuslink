import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(
    new URL('../../components/content/submission-form.tsx', import.meta.url),
  ),
  'utf8',
);

describe('submission form async event safety', () => {
  it('captures the form before awaiting and resets the captured element', () => {
    const capture = source.indexOf('const form = event.currentTarget;');
    const firstAwait = source.indexOf('await ', source.indexOf('async function submit'));
    expect(capture).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(firstAwait);
    expect(source).toContain('new FormData(form)');
    expect(source).toContain('form.reset()');
    expect(source).not.toContain('event.currentTarget.reset()');
  });
});
