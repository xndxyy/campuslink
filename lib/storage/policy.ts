import 'server-only';

import { randomUUID } from 'node:crypto';

import { getDb } from '@/lib/db';
import { normalizeContentType, type UploadKind } from '@/lib/validation/upload';

import { createS3UploadStorage } from './client';
import { buildStorageKey } from './keys';

export type UploadAssetStatus = 'PENDING' | 'READY' | 'REJECTED';

export interface UploadAssetRecord {
  contentType: string;
  id: string;
  kind: UploadKind;
  ownerId: string;
  sizeBytes: bigint;
  status: UploadAssetStatus;
  storageKey: string;
}

export interface AssetRepository {
  create(record: UploadAssetRecord): Promise<UploadAssetRecord>;
  findById(assetId: string): Promise<UploadAssetRecord | null>;
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
  }): Promise<string>;
  headObject(key: string): Promise<{
    contentLength: number | undefined;
    contentType: string | undefined;
    key: string;
  }>;
}

export interface UploadPolicyDependencies {
  createAssetId?: () => string;
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
    async create(record) {
      return db.asset.create({ data: record });
    },
    async findById(assetId) {
      return db.asset.findUnique({ where: { id: assetId } });
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
    sizeBytes: BigInt(input.sizeBytes),
    status: 'PENDING',
    storageKey,
  };

  await dependencies.repository.create(asset);
  const uploadUrl = await dependencies.storage.createPresignedPutUrl({
    contentType: input.contentType,
    expiresInSeconds: PRESIGNED_UPLOAD_LIFETIME_SECONDS,
    key: storageKey,
  });

  return {
    assetId,
    contentType: input.contentType,
    expiresInSeconds: PRESIGNED_UPLOAD_LIFETIME_SECONDS,
    uploadUrl,
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

  const metadata = await dependencies.storage.headObject(asset.storageKey);
  if (!metadataMatches(asset, metadata)) {
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
