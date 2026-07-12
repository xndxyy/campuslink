import 'server-only';

import { randomUUID } from 'node:crypto';

import { getDb } from '@/lib/db';
import { normalizeContentType, type UploadKind } from '@/lib/validation/upload';

import { createS3UploadStorage, StorageObjectNotFoundError } from './client';
import { buildStorageKey } from './keys';

export type UploadAssetStatus = 'PENDING' | 'READY' | 'REJECTED' | 'CLEANING';

export interface UploadAssetRecord {
  contentType: string;
  id: string;
  kind: UploadKind;
  ownerId: string;
  scanStatus: 'NOT_REQUIRED' | 'PENDING' | 'CLEAN' | 'INFECTED' | 'ERROR';
  sizeBytes: bigint;
  status: UploadAssetStatus;
  storageKey: string;
  uploadExpiresAt: Date | null;
}

export interface AssetRepository {
  claimExpiredPending(input: {
    assetId: string;
    expiredAtOrBefore: Date;
  }): Promise<boolean>;
  create(record: UploadAssetRecord): Promise<UploadAssetRecord>;
  deleteClaimed(input: {
    assetId: string;
    expiredAtOrBefore: Date;
  }): Promise<boolean>;
  deletePending(input: {
    assetId: string;
    expiredAtOrBefore?: Date;
    ownerId?: string;
  }): Promise<boolean>;
  findCleanupCandidates(now: Date, limit: number): Promise<UploadAssetRecord[]>;
  findById(assetId: string): Promise<UploadAssetRecord | null>;
  markRejectedCleaned(assetId: string): Promise<boolean>;
  transitionStatus(input: {
    assetId: string;
    from: UploadAssetStatus;
    ownerId: string;
    to: UploadAssetStatus;
  }): Promise<boolean>;
}

export interface UploadStorage {
  createPresignedPutUrl(input: {
    contentType: string;
    expiresInSeconds: number;
    key: string;
    sizeBytes: number;
  }): Promise<{
    requiredHeaders: Record<string, string>;
    uploadUrl: string;
  }>;
  deleteObject(key: string): Promise<void>;
  headObject(key: string): Promise<{
    contentLength: number | undefined;
    contentType: string | undefined;
    key: string;
  }>;
}

export interface UploadPolicyDependencies {
  createAssetId?: () => string;
  now?: () => Date;
  repository: AssetRepository;
  storage: UploadStorage;
}

export interface ValidatedUploadIntent {
  canonicalExtension: string;
  contentType: string;
  displayName: string;
  kind: UploadKind;
  sizeBytes: number;
}

export class UploadNotFoundError extends Error {
  constructor() {
    super('Upload intent was not found.');
    this.name = 'UploadNotFoundError';
  }
}

export class UploadForbiddenError extends Error {
  constructor() {
    super('Upload does not belong to this user.');
    this.name = 'UploadForbiddenError';
  }
}

export class UploadConflictError extends Error {
  constructor() {
    super('Upload cannot be completed in its current state.');
    this.name = 'UploadConflictError';
  }
}

export class UploadMismatchError extends UploadConflictError {
  constructor() {
    super();
    this.name = 'UploadMismatchError';
  }
}

const PRESIGNED_UPLOAD_LIFETIME_SECONDS = 5 * 60;

export function createPrismaAssetRepository(
  db: ReturnType<typeof getDb> = getDb(),
): AssetRepository {
  return {
    async claimExpiredPending({ assetId, expiredAtOrBefore }) {
      const claimed = await db.asset.updateMany({
        data: { status: 'CLEANING' },
        where: {
          id: assetId,
          status: 'PENDING',
          uploadExpiresAt: { lte: expiredAtOrBefore },
        },
      });
      return claimed.count === 1;
    },
    async create(record) {
      return db.asset.create({ data: record });
    },
    async deleteClaimed({ assetId, expiredAtOrBefore }) {
      const deleted = await db.asset.deleteMany({
        where: {
          id: assetId,
          status: 'CLEANING',
          uploadExpiresAt: { lte: expiredAtOrBefore },
        },
      });
      return deleted.count === 1;
    },
    async deletePending({ assetId, expiredAtOrBefore, ownerId }) {
      const deleted = await db.asset.deleteMany({
        where: {
          id: assetId,
          ownerId,
          status: 'PENDING',
          uploadExpiresAt: expiredAtOrBefore
            ? { lte: expiredAtOrBefore }
            : undefined,
        },
      });
      return deleted.count === 1;
    },
    async findCleanupCandidates(now, limit) {
      return db.asset.findMany({
        orderBy: { uploadExpiresAt: 'asc' },
        take: limit,
        where: {
          status: { in: ['PENDING', 'CLEANING', 'REJECTED'] },
          uploadExpiresAt: { lte: now },
        },
      });
    },
    async findById(assetId) {
      return db.asset.findUnique({ where: { id: assetId } });
    },
    async markRejectedCleaned(assetId) {
      const updated = await db.asset.updateMany({
        data: { uploadExpiresAt: null },
        where: { id: assetId, status: 'REJECTED' },
      });
      return updated.count === 1;
    },
    async transitionStatus({ assetId, from, ownerId, to }) {
      const updated = await db.asset.updateMany({
        data: { status: to },
        where: { id: assetId, ownerId, status: from },
      });
      return updated.count === 1;
    },
  };
}

function defaultDependencies(): UploadPolicyDependencies {
  return {
    repository: createPrismaAssetRepository(),
    storage: createS3UploadStorage(),
  };
}

export async function createUploadIntent(
  ownerId: string,
  input: ValidatedUploadIntent,
  dependencies: UploadPolicyDependencies = defaultDependencies(),
) {
  const assetId = (dependencies.createAssetId ?? randomUUID)();
  const now = (dependencies.now ?? (() => new Date()))();
  const uploadExpiresAt = new Date(
    now.getTime() + PRESIGNED_UPLOAD_LIFETIME_SECONDS * 1_000,
  );
  const storageKey = buildStorageKey(
    ownerId,
    assetId,
    input.canonicalExtension,
  );
  const asset: UploadAssetRecord = {
    contentType: input.contentType,
    id: assetId,
    kind: input.kind,
    ownerId,
    scanStatus: input.kind === 'RESOURCE_DOCUMENT' ? 'PENDING' : 'NOT_REQUIRED',
    sizeBytes: BigInt(input.sizeBytes),
    status: 'PENDING',
    storageKey,
    uploadExpiresAt,
  };

  await dependencies.repository.create(asset);
  let signed: Awaited<ReturnType<UploadStorage['createPresignedPutUrl']>>;
  try {
    signed = await dependencies.storage.createPresignedPutUrl({
      contentType: input.contentType,
      expiresInSeconds: PRESIGNED_UPLOAD_LIFETIME_SECONDS,
      key: storageKey,
      sizeBytes: input.sizeBytes,
    });
  } catch (error) {
    try {
      const deleted = await dependencies.repository.deletePending({
        assetId,
        ownerId,
      });
      if (!deleted) {
        await dependencies.repository.transitionStatus({
          assetId,
          from: 'PENDING',
          ownerId,
          to: 'REJECTED',
        });
      }
    } catch {
      await dependencies.repository
        .transitionStatus({
          assetId,
          from: 'PENDING',
          ownerId,
          to: 'REJECTED',
        })
        .catch(() => false);
    }
    throw error;
  }

  return {
    assetId,
    contentType: input.contentType,
    expiresAt: uploadExpiresAt.toISOString(),
    expiresInSeconds: PRESIGNED_UPLOAD_LIFETIME_SECONDS,
    requiredHeaders: signed.requiredHeaders,
    uploadUrl: signed.uploadUrl,
  };
}

function metadataMatches(
  asset: UploadAssetRecord,
  metadata: Awaited<ReturnType<UploadStorage['headObject']>>,
): boolean {
  return (
    metadata.key === asset.storageKey &&
    metadata.contentLength !== undefined &&
    Number.isSafeInteger(metadata.contentLength) &&
    metadata.contentLength >= 0 &&
    BigInt(metadata.contentLength) === asset.sizeBytes &&
    metadata.contentType !== undefined &&
    normalizeContentType(metadata.contentType) === asset.contentType
  );
}

export async function completeUpload(
  ownerId: string,
  assetId: string,
  dependencies: UploadPolicyDependencies = defaultDependencies(),
) {
  const asset = await dependencies.repository.findById(assetId);
  if (!asset) {
    throw new UploadNotFoundError();
  }
  if (asset.ownerId !== ownerId) {
    throw new UploadForbiddenError();
  }
  if (asset.status === 'READY') {
    return { assetId: asset.id, status: 'READY' as const };
  }
  if (asset.status !== 'PENDING') {
    throw new UploadConflictError();
  }

  let metadata: Awaited<ReturnType<UploadStorage['headObject']>>;
  try {
    metadata = await dependencies.storage.headObject(asset.storageKey);
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) {
      await dependencies.repository.transitionStatus({
        assetId: asset.id,
        from: 'PENDING',
        ownerId,
        to: 'REJECTED',
      });
      throw new UploadMismatchError();
    }
    throw error;
  }
  if (!metadataMatches(asset, metadata)) {
    await dependencies.storage.deleteObject(asset.storageKey).catch(() => {});
    await dependencies.repository.transitionStatus({
      assetId: asset.id,
      from: 'PENDING',
      ownerId,
      to: 'REJECTED',
    });
    throw new UploadMismatchError();
  }

  const transitioned = await dependencies.repository.transitionStatus({
    assetId: asset.id,
    from: 'PENDING',
    ownerId,
    to: 'READY',
  });
  if (!transitioned) {
    const latest = await dependencies.repository.findById(asset.id);
    if (latest?.ownerId === ownerId && latest.status === 'READY') {
      return { assetId: latest.id, status: 'READY' as const };
    }
    throw new UploadConflictError();
  }

  return { assetId: asset.id, status: 'READY' as const };
}

export async function cleanupStaleUploads(
  dependencies: UploadPolicyDependencies = defaultDependencies(),
  limit = 100,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error('Cleanup limit must be between 1 and 1000.');
  }

  const now = (dependencies.now ?? (() => new Date()))();
  const candidates = await dependencies.repository.findCleanupCandidates(
    now,
    limit,
  );
  const result = { deletedPending: 0, failed: 0, retainedRejected: 0 };

  for (const asset of candidates) {
    let cleanupStatus = asset.status;
    if (cleanupStatus === 'PENDING') {
      const claimed = await dependencies.repository.claimExpiredPending({
        assetId: asset.id,
        expiredAtOrBefore: now,
      });
      if (!claimed) continue;
      cleanupStatus = 'CLEANING';
    }

    try {
      await dependencies.storage.deleteObject(asset.storageKey);
      if (cleanupStatus === 'CLEANING') {
        const deleted = await dependencies.repository.deleteClaimed({
          assetId: asset.id,
          expiredAtOrBefore: now,
        });
        result.deletedPending += deleted ? 1 : 0;
        result.failed += deleted ? 0 : 1;
      } else {
        const retained = await dependencies.repository.markRejectedCleaned(
          asset.id,
        );
        result.retainedRejected += retained ? 1 : 0;
        result.failed += retained ? 0 : 1;
      }
    } catch {
      result.failed += 1;
    }
  }

  return result;
}
