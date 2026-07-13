import { describe, expect, it, vi } from 'vitest';

import { StorageObjectNotFoundError } from '@/lib/storage/client';
import {
  cleanupStaleUploads,
  completeUpload,
  createUploadIntent,
  UploadForbiddenError,
  UploadMismatchError,
  type AssetRepository,
  type UploadAssetRecord,
  type UploadAssetStatus,
  type UploadStorage,
} from '@/lib/storage/policy';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const pendingAsset: UploadAssetRecord = {
  contentType: 'application/pdf',
  id: 'asset_01JUPLOADTEST',
  kind: 'RESOURCE_DOCUMENT',
  ownerId: 'user_01JOWNERTEST',
  scanStatus: 'PENDING',
  sizeBytes: BigInt(1_024),
  status: 'PENDING',
  storageKey: 'campus/user_01JOWNERTEST/asset_01JUPLOADTEST.pdf',
  uploadExpiresAt: new Date('2026-07-12T08:05:00.000Z'),
};

function createDependencies(asset: UploadAssetRecord | null = pendingAsset) {
  const repository: AssetRepository = {
    claimExpiredPending: vi.fn(async () => true),
    create: vi.fn(async (record) => record),
    deleteClaimed: vi.fn(async () => true),
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
  it('creates announcement image intents in the announcement namespace', async () => {
    const dependencies = createDependencies();

    await createUploadIntent(
      pendingAsset.ownerId,
      {
        canonicalExtension: 'png',
        contentType: 'image/png',
        displayName: 'cover.png',
        kind: 'ANNOUNCEMENT_IMAGE',
        sizeBytes: 1_024,
      },
      {
        ...dependencies,
        createAssetId: () => pendingAsset.id,
        now: () => new Date('2026-07-12T08:00:00.000Z'),
      },
    );

    expect(dependencies.repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ANNOUNCEMENT_IMAGE',
        storageKey: 'announcements/user_01JOWNERTEST/asset_01JUPLOADTEST.png',
      }),
    );
    expect(dependencies.storage.createPresignedPutUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'announcements/user_01JOWNERTEST/asset_01JUPLOADTEST.png',
      }),
    );
  });

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

  it('rejects a pending intent when completion cannot find its object', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.storage.headObject).mockRejectedValue(
      new StorageObjectNotFoundError(),
    );

    await expect(
      completeUpload(pendingAsset.ownerId, pendingAsset.id, dependencies),
    ).rejects.toBeInstanceOf(UploadMismatchError);
    expect(dependencies.repository.transitionStatus).toHaveBeenCalledWith({
      assetId: pendingAsset.id,
      from: 'PENDING',
      ownerId: pendingAsset.ownerId,
      to: 'REJECTED',
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
    expect(dependencies.repository.claimExpiredPending).toHaveBeenCalledWith({
      assetId: pendingAsset.id,
      expiredAtOrBefore: new Date('2026-07-12T08:10:00.000Z'),
    });
    expect(dependencies.repository.deleteClaimed).toHaveBeenCalledWith({
      assetId: pendingAsset.id,
      expiredAtOrBefore: new Date('2026-07-12T08:10:00.000Z'),
    });
    expect(dependencies.repository.markRejectedCleaned).toHaveBeenCalledWith(
      'asset_rejected',
    );
  });

  it('does not delete storage when completion wins before the cleanup claim', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.repository.claimExpiredPending).mockResolvedValue(
      false,
    );
    vi.mocked(dependencies.repository.findCleanupCandidates).mockResolvedValue([
      pendingAsset,
    ]);

    await expect(
      cleanupStaleUploads(
        { ...dependencies, now: () => new Date('2026-07-12T08:10:00.000Z') },
        25,
      ),
    ).resolves.toEqual({
      deletedPending: 0,
      failed: 0,
      retainedRejected: 0,
    });
    expect(dependencies.storage.deleteObject).not.toHaveBeenCalled();
  });

  it('retains a claimed row and prevents READY when cleanup wins', async () => {
    const dependencies = createDependencies({
      ...pendingAsset,
      status: 'CLEANING',
    });
    vi.mocked(dependencies.storage.deleteObject).mockRejectedValue(
      new Error('storage unavailable'),
    );
    vi.mocked(dependencies.repository.findCleanupCandidates).mockResolvedValue([
      pendingAsset,
    ]);

    await expect(
      cleanupStaleUploads(
        { ...dependencies, now: () => new Date('2026-07-12T08:10:00.000Z') },
        25,
      ),
    ).resolves.toEqual({
      deletedPending: 0,
      failed: 1,
      retainedRejected: 0,
    });
    expect(dependencies.repository.deleteClaimed).not.toHaveBeenCalled();
    await expect(
      completeUpload(pendingAsset.ownerId, pendingAsset.id, dependencies),
    ).rejects.toThrow('current state');
    expect(dependencies.repository.transitionStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: 'READY' }),
    );
  });

  it('deterministically serializes cleanup claims against completion', async () => {
    let completionFirstStatus: UploadAssetStatus | null = 'PENDING';
    const claimEntered = deferred();
    const releaseClaim = deferred();
    const completionFirst = createDependencies();
    vi.mocked(
      completionFirst.repository.findCleanupCandidates,
    ).mockResolvedValue([pendingAsset]);
    vi.mocked(completionFirst.repository.findById).mockImplementation(
      async () =>
        completionFirstStatus
          ? { ...pendingAsset, status: completionFirstStatus }
          : null,
    );
    vi.mocked(completionFirst.repository.transitionStatus).mockImplementation(
      async ({ from, to }) => {
        if (completionFirstStatus !== from) return false;
        completionFirstStatus = to;
        return true;
      },
    );
    vi.mocked(
      completionFirst.repository.claimExpiredPending,
    ).mockImplementation(async () => {
      claimEntered.resolve();
      await releaseClaim.promise;
      if (completionFirstStatus !== 'PENDING') return false;
      completionFirstStatus = 'CLEANING';
      return true;
    });

    const cleanupAfterCompletion = cleanupStaleUploads(
      {
        ...completionFirst,
        now: () => new Date('2026-07-12T08:10:00.000Z'),
      },
      25,
    );
    await claimEntered.promise;
    await completeUpload(
      pendingAsset.ownerId,
      pendingAsset.id,
      completionFirst,
    );
    releaseClaim.resolve();
    await cleanupAfterCompletion;
    expect(completionFirstStatus).toBe('READY');
    expect(completionFirst.storage.deleteObject).not.toHaveBeenCalled();

    let cleanupFirstStatus: UploadAssetStatus | null = 'PENDING';
    const headEntered = deferred();
    const releaseHead = deferred();
    const cleanupFirst = createDependencies();
    vi.mocked(cleanupFirst.repository.findCleanupCandidates).mockResolvedValue([
      pendingAsset,
    ]);
    vi.mocked(cleanupFirst.repository.findById).mockImplementation(async () =>
      cleanupFirstStatus
        ? { ...pendingAsset, status: cleanupFirstStatus }
        : null,
    );
    vi.mocked(cleanupFirst.repository.claimExpiredPending).mockImplementation(
      async () => {
        if (cleanupFirstStatus !== 'PENDING') return false;
        cleanupFirstStatus = 'CLEANING';
        return true;
      },
    );
    vi.mocked(cleanupFirst.repository.deleteClaimed).mockImplementation(
      async () => {
        if (cleanupFirstStatus !== 'CLEANING') return false;
        cleanupFirstStatus = null;
        return true;
      },
    );
    vi.mocked(cleanupFirst.repository.transitionStatus).mockImplementation(
      async ({ from, to }) => {
        if (cleanupFirstStatus !== from) return false;
        cleanupFirstStatus = to;
        return true;
      },
    );
    vi.mocked(cleanupFirst.storage.headObject).mockImplementation(
      async (key) => {
        headEntered.resolve();
        await releaseHead.promise;
        return {
          contentLength: 1_024,
          contentType: 'application/pdf',
          key,
        };
      },
    );

    const completionAfterCleanup = completeUpload(
      pendingAsset.ownerId,
      pendingAsset.id,
      cleanupFirst,
    );
    await headEntered.promise;
    await cleanupStaleUploads(
      { ...cleanupFirst, now: () => new Date('2026-07-12T08:10:00.000Z') },
      25,
    );
    releaseHead.resolve();
    await expect(completionAfterCleanup).rejects.toThrow('current state');
    expect(cleanupFirstStatus).toBeNull();
    expect(cleanupFirst.storage.deleteObject).toHaveBeenCalledOnce();
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
