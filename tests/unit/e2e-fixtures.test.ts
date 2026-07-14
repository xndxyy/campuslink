import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createTagSlug } from '@/lib/validation/tags';
import { createPublishContentRunTags } from '@/tests/helpers/publish-content-run-tags';

describe('browser upload fixtures', () => {
  it('provides a pure run-scoped publish tag factory', () => {
    const path = fileURLToPath(
      new URL('../helpers/publish-content-run-tags.ts', import.meta.url),
    );
    const source = existsSync(path) ? readFileSync(path, 'utf8') : '';
    expect(source).toContain('export function createPublishContentRunTags');
  });

  it('derives three bounded exact tag definitions from the run id', () => {
    const runId = '12345678-abcd-4abc-8abc-1234567890ab';
    const tags = createPublishContentRunTags(runId);
    expect(tags).toMatchObject({
      campusWork: { scope: 'CAMPUS_WORK' },
      marketplace: { scope: 'MARKETPLACE' },
      resource: { scope: 'RESOURCE' },
    });
    const values = [tags.resource, tags.marketplace, tags.campusWork];
    expect(new Set(values.map((tag) => tag.label)).size).toBe(3);
    expect(new Set(values.map((tag) => tag.slug)).size).toBe(3);
    for (const tag of values) {
      expect(tag.label).toContain('12345678');
      expect(Array.from(tag.label).length).toBeLessThanOrEqual(32);
      expect(tag.slug).toBe(createTagSlug(tag.label));
    }
  });

  it('never reuses tag definitions across different runs', () => {
    const first = createPublishContentRunTags(
      'aaaaaaaa-abcd-4abc-8abc-1234567890ab',
    );
    const second = createPublishContentRunTags(
      'bbbbbbbb-abcd-4abc-8abc-1234567890ab',
    );
    const firstSlugs = new Set(Object.values(first).map((tag) => tag.slug));
    expect(
      Object.values(second).every((tag) => !firstSlugs.has(tag.slug)),
    ).toBe(true);
  });

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
