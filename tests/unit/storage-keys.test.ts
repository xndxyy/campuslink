import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildStorageKey } from '@/lib/storage/keys';

describe('storage object keys', () => {
  it('uses strict owner and unpredictable asset identifiers without a filename', () => {
    const ownerId = randomUUID();
    const firstAssetId = randomUUID();
    const secondAssetId = randomUUID();

    const firstKey = buildStorageKey(ownerId, firstAssetId, 'pdf');
    const secondKey = buildStorageKey(ownerId, secondAssetId, 'pdf');

    expect(firstKey).toBe(`campus/${ownerId}/${firstAssetId}.pdf`);
    expect(secondKey).not.toBe(firstKey);
    expect(firstKey).not.toContain('lecture-notes');
  });

  it.each([
    ['../owner', randomUUID(), 'pdf'],
    [randomUUID(), '../asset', 'pdf'],
    [randomUUID(), randomUUID(), 'pdf.exe'],
    [randomUUID(), randomUUID(), 'SVG'],
  ])('rejects an unsafe key segment', (ownerId, assetId, extension) => {
    expect(() => buildStorageKey(ownerId, assetId, extension)).toThrow();
  });
});
