import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('browser upload fixtures', () => {
  it('uses a real PNG marketplace image', () => {
    const path = fileURLToPath(
      new URL('../fixtures/marketplace.png', import.meta.url),
    );
    const bytes = readFileSync(path);
    expect([...bytes.subarray(0, 8)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    expect(path.endsWith('.png')).toBe(true);
  });

  it('keeps the standalone provisioner outside Next server-only modules', () => {
    const script = readFileSync(
      fileURLToPath(new URL('../../scripts/provision-e2e.ts', import.meta.url)),
      'utf8',
    );
    expect(script).not.toContain('../lib/storage/client');
    expect(script).toContain('S3Client');
  });
});
