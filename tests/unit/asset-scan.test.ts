import { describe, expect, it, vi } from 'vitest';

import {
  recordAssetScanResult,
  ScanResultConflictError,
  type AssetScanRepository,
} from '@/lib/storage/scanning';

function dependencies() {
  const repository: AssetScanRepository = {
    findById: vi.fn(async () => ({
      id: 'asset_1',
      kind: 'RESOURCE_DOCUMENT',
      ownerId: 'user_1',
      scanStatus: 'PENDING' as const,
      status: 'READY' as const,
      storageKey: 'campus/user_1/asset_1.pdf',
    })),
    recordResult: vi.fn(async () => true),
  };
  return {
    now: () => new Date('2026-07-13T00:00:00.000Z'),
    repository,
    storage: { deleteObject: vi.fn(async () => undefined) },
  };
}

describe('attachment malware scan results', () => {
  it('records a clean verdict without changing storage readiness', async () => {
    const deps = dependencies();
    await expect(
      recordAssetScanResult(
        {
          assetId: 'asset_1',
          sha256: 'a'.repeat(64),
          verdict: 'CLEAN',
        },
        deps,
      ),
    ).resolves.toEqual({ assetId: 'asset_1', scanStatus: 'CLEAN' });
    expect(deps.repository.recordResult).toHaveBeenCalledWith({
      assetId: 'asset_1',
      from: 'PENDING',
      scannedAt: new Date('2026-07-13T00:00:00.000Z'),
      sha256: 'a'.repeat(64),
      to: 'CLEAN',
    });
    expect(deps.storage.deleteObject).not.toHaveBeenCalled();
  });

  it('accepts a storage-event verdict before browser completion wins the race', async () => {
    const deps = dependencies();
    vi.mocked(deps.repository.findById).mockResolvedValueOnce({
      id: 'asset_1',
      kind: 'RESOURCE_DOCUMENT',
      ownerId: 'user_1',
      scanStatus: 'PENDING',
      status: 'PENDING',
      storageKey: 'campus/user_1/asset_1.pdf',
    });
    await expect(
      recordAssetScanResult(
        { assetId: 'asset_1', sha256: 'e'.repeat(64), verdict: 'CLEAN' },
        deps,
      ),
    ).resolves.toEqual({ assetId: 'asset_1', scanStatus: 'CLEAN' });
    expect(deps.repository.recordResult).toHaveBeenCalledWith({
      assetId: 'asset_1',
      from: 'PENDING',
      scannedAt: new Date('2026-07-13T00:00:00.000Z'),
      sha256: 'e'.repeat(64),
      to: 'CLEAN',
    });
  });

  it('rejects and removes an infected document before it can be published', async () => {
    const deps = dependencies();
    await expect(
      recordAssetScanResult(
        {
          assetId: 'asset_1',
          sha256: 'b'.repeat(64),
          verdict: 'INFECTED',
        },
        deps,
      ),
    ).resolves.toEqual({ assetId: 'asset_1', scanStatus: 'INFECTED' });
    expect(deps.repository.recordResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'REJECTED', to: 'INFECTED' }),
    );
    expect(deps.storage.deleteObject).toHaveBeenCalledWith(
      'campus/user_1/asset_1.pdf',
    );
  });

  it('rejects callbacks for images and stale or repeated scan transitions', async () => {
    const image = dependencies();
    vi.mocked(image.repository.findById).mockResolvedValueOnce({
      id: 'asset_1',
      kind: 'MARKETPLACE_IMAGE',
      ownerId: 'user_1',
      scanStatus: 'NOT_REQUIRED',
      status: 'READY',
      storageKey: 'campus/user_1/asset_1.png',
    });
    await expect(
      recordAssetScanResult(
        { assetId: 'asset_1', sha256: 'c'.repeat(64), verdict: 'CLEAN' },
        image,
      ),
    ).rejects.toBeInstanceOf(ScanResultConflictError);

    const raced = dependencies();
    vi.mocked(raced.repository.recordResult).mockResolvedValueOnce(false);
    await expect(
      recordAssetScanResult(
        { assetId: 'asset_1', sha256: 'd'.repeat(64), verdict: 'ERROR' },
        raced,
      ),
    ).rejects.toBeInstanceOf(ScanResultConflictError);
  });
});
