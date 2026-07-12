import { describe, expect, it, vi } from 'vitest';

import {
  cleanupStaleUploads,
  completeUpload,
  createUploadIntent,
  UploadForbiddenError,
  UploadMismatchError,
  type AssetRepository,
  type UploadAssetRecord,
  type UploadStorage,
} from '@/lib/storage/policy';

const pendingAsset: UploadAssetRecord = {
  contentType: 'application/pdf',
  id: 'asset_01JUPLOADTEST',
  kind: 'RESOURCE_DOCUMENT',
  ownerId: 'user_01JOWNERTEST',
  sizeBytes: BigInt(1_024),
  status: 'PENDING',
  storageKey: 'campus/user_01JOWNERTEST/asset_01JUPLOADTEST.pdf',
  uploadExpiresAt: new Date('2026-07-12T08:05:00.000Z'),
};

function createDependencies(asset: UploadAssetRecord | null = pendingAsset) {
  const repository: AssetRepository = {
    create: vi.fn(async (record) => record),
    deletePending: vi.fn(async () => true),
    findCleanupCandidates: vi.fn(async () => []),
    findById: vi.fn(async () => asset),
    markRejectedCleaned: vi.fn(async () => true),
    transitionStatus: vi.fn(async () => true),
  };
  const storage: UploadStorage = {
    createPresignedPutUrl: vi.fn(async () => ({
      requiredHeaders: {
        'Content-Type': 'application/pdf',
        'If-None-Match': '*',
      },
      uploadUrl: 'https://storage.test/upload',
    })),
    deleteObject: vi.fn(async () => undefined),
    headObject: vi.fn(async (key) => ({
      contentLength: 1_024,
      contentType: 'application/pdf',
      key,
    })),
  };

  return { repository, storage };
}

describe('upload service', () => {
  it('creates a pending owned asset and signs exactly five minutes', async () => {
    const dependencies = createDependencies();

    const result = await createUploadIntent(
      pendingAsset.ownerId,
      {
        canonicalExtension: 'pdf',
        contentType: pendingAsset.contentType,
        displayName: 'lecture.pdf',
        kind: pendingAsset.kind,
        sizeBytes: Number(pendingAsset.sizeBytes),
      },
      {
        ...dependencies,
        createAssetId: () => pendingAsset.id,
        now: () => new Date('2026-07-12T08:00:00.000Z'),
      },
    );

    expect(dependencies.repository.create).toHaveBeenCalledWith(pendingAsset);
    expect(dependencies.storage.createPresignedPutUrl).toHaveBeenCalledWith({
      contentType: pendingAsset.contentType,
      expiresInSeconds: 300,
      key: pendingAsset.storageKey,
      sizeBytes: 1_024,
    });
    expect(result).toEqual({
      assetId: pendingAsset.id,
      contentType: pendingAsset.contentType,
      expiresAt: '2026-07-12T08:05:00.000Z',
      expiresInSeconds: 300,
      requiredHeaders: {
        'Content-Type': 'application/pdf',
        'If-None-Match': '*',
      },
      uploadUrl: 'https://storage.test/upload',
    });
  });

  it('compensates the pending row when signing fails', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.storage.createPresignedPutUrl).mockRejectedValue(
      new Error('signing failed'),
    );

    await expect(
      createUploadIntent(
        pendingAsset.ownerId,
        {
          canonicalExtension: 'pdf',
          contentType: pendingAsset.contentType,
          displayName: 'lecture.pdf',
          kind: pendingAsset.kind,
          sizeBytes: 1_024,
        },
        {
          ...dependencies,
          createAssetId: () => pendingAsset.id,
          now: () => new Date('2026-07-12T08:00:00.000Z'),
        },
      ),
    ).rejects.toThrow('signing failed');
    expect(dependencies.repository.deletePending).toHaveBeenCalledWith({
      assetId: pendingAsset.id,
      ownerId: pendingAsset.ownerId,
    });
  });

  it('marks a matching pending object ready', async () => {
    const dependencies = createDependencies();

    await expect(
      completeUpload(pendingAsset.ownerId, pendingAsset.id, dependencies),
    ).resolves.toEqual({ assetId: pendingAsset.id, status: 'READY' });

    expect(dependencies.storage.headObject).toHaveBeenCalledWith(
      pendingAsset.storageKey,
    );
    expect(dependencies.repository.transitionStatus).toHaveBeenCalledWith({
      assetId: pendingAsset.id,
      from: 'PENDING',
      ownerId: pendingAsset.ownerId,
      to: 'READY',
    });
  });

  it.each([
    [
      'key',
      {
        contentLength: 1_024,
        contentType: 'application/pdf',
        key: 'campus/other/object.pdf',
      },
    ],
    [
      'size',
      {
        contentLength: 2_048,
        contentType: 'application/pdf',
        key: pendingAsset.storageKey,
      },
    ],
    [
      'content type',
      {
        contentLength: 1_024,
        contentType: 'text/html',
        key: pendingAsset.storageKey,
      },
    ],
  ])('rejects and records a %s mismatch', async (_field, objectMetadata) => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.storage.headObject).mockResolvedValue(
      objectMetadata,
    );

    await expect(
      completeUpload(pendingAsset.ownerId, pendingAsset.id, dependencies),
    ).rejects.toBeInstanceOf(UploadMismatchError);
    expect(dependencies.storage.deleteObject).toHaveBeenCalledWith(
      pendingAsset.storageKey,
    );
    expect(dependencies.repository.transitionStatus).toHaveBeenCalledWith({
      assetId: pendingAsset.id,
      from: 'PENDING',
      ownerId: pendingAsset.ownerId,
      to: 'REJECTED',
    });
  });

  it('deletes expired pending objects and retains cleaned rejected records', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.repository.findCleanupCandidates).mockResolvedValue([
      pendingAsset,
      { ...pendingAsset, id: 'asset_rejected', status: 'REJECTED' },
    ]);

    await expect(
      cleanupStaleUploads(
        { ...dependencies, now: () => new Date('2026-07-12T08:10:00.000Z') },
        25,
      ),
    ).resolves.toEqual({
      deletedPending: 1,
      failed: 0,
      retainedRejected: 1,
    });
    expect(dependencies.storage.deleteObject).toHaveBeenCalledTimes(2);
    expect(dependencies.repository.deletePending).toHaveBeenCalledWith({
      assetId: pendingAsset.id,
      expiredAtOrBefore: new Date('2026-07-12T08:10:00.000Z'),
    });
    expect(dependencies.repository.markRejectedCleaned).toHaveBeenCalledWith(
      'asset_rejected',
    );
  });

  it('forbids another owner before contacting storage', async () => {
    const dependencies = createDependencies();

    await expect(
      completeUpload('user_someone_else', pendingAsset.id, dependencies),
    ).rejects.toBeInstanceOf(UploadForbiddenError);
    expect(dependencies.storage.headObject).not.toHaveBeenCalled();
    expect(dependencies.repository.transitionStatus).not.toHaveBeenCalled();
  });

  it('returns an owned ready asset idempotently without contacting storage', async () => {
    const dependencies = createDependencies({
      ...pendingAsset,
      status: 'READY',
    });

    await expect(
      completeUpload(pendingAsset.ownerId, pendingAsset.id, dependencies),
    ).resolves.toEqual({ assetId: pendingAsset.id, status: 'READY' });
    expect(dependencies.storage.headObject).not.toHaveBeenCalled();
    expect(dependencies.repository.transitionStatus).not.toHaveBeenCalled();
  });
});
