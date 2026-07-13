import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildStorageKey } from '@/lib/storage/keys';

describe('storage object keys', () => {
  it('uses strict owner and unpredictable asset identifiers without a filename', () => {
    const ownerId = randomUUID();
    const firstAssetId = randomUUID();
    const secondAssetId = randomUUID();

    const firstKey = buildStorageKey(
      ownerId,
      firstAssetId,
      'pdf',
      'RESOURCE_DOCUMENT',
    );
    const secondKey = buildStorageKey(
      ownerId,
      secondAssetId,
      'pdf',
      'RESOURCE_DOCUMENT',
    );

    expect(firstKey).toBe(`campus/${ownerId}/${firstAssetId}.pdf`);
    expect(secondKey).not.toBe(firstKey);
    expect(firstKey).not.toContain('lecture-notes');
  });

  it('isolates announcement images under their own namespace', () => {
    const ownerId = randomUUID();
    const assetId = randomUUID();

    expect(
      buildStorageKey(ownerId, assetId, 'webp', 'ANNOUNCEMENT_IMAGE'),
    ).toBe(`announcements/${ownerId}/${assetId}.webp`);
  });

  it.each([
    'RESOURCE_DOCUMENT',
    'RESOURCE_IMAGE',
    'MARKETPLACE_IMAGE',
  ] as const)('keeps %s under the existing campus namespace', (kind) => {
    const ownerId = randomUUID();
    const assetId = randomUUID();

    expect(buildStorageKey(ownerId, assetId, 'png', kind)).toBe(
      `campus/${ownerId}/${assetId}.png`,
    );
  });

  it.each([
    ['../owner', randomUUID(), 'pdf'],
    [randomUUID(), '../asset', 'pdf'],
    [randomUUID(), randomUUID(), 'pdf.exe'],
    [randomUUID(), randomUUID(), 'SVG'],
  ])('rejects an unsafe key segment', (ownerId, assetId, extension) => {
    expect(() =>
      buildStorageKey(ownerId, assetId, extension, 'RESOURCE_DOCUMENT'),
    ).toThrow();
  });

  it('rejects an upload kind without an approved namespace', () => {
    expect(() =>
      buildStorageKey(
        randomUUID(),
        randomUUID(),
        'png',
        'UNSAFE_NAMESPACE' as 'RESOURCE_IMAGE',
      ),
    ).toThrow();
  });
});
