import 'server-only';

import { getDb } from '@/lib/db';

import { createS3UploadStorage } from './client';

export type AssetScanStatus =
  'NOT_REQUIRED' | 'PENDING' | 'CLEAN' | 'INFECTED' | 'ERROR';

interface ScannableAsset {
  id: string;
  kind: string;
  ownerId: string;
  scanStatus: AssetScanStatus;
  status: string;
  storageKey: string;
}

export interface AssetScanRepository {
  findById(assetId: string): Promise<ScannableAsset | null>;
  recordResult(input: {
    assetId: string;
    from: 'PENDING' | 'ERROR';
    scannedAt: Date;
    sha256: string;
    status?: 'REJECTED';
    to: 'CLEAN' | 'INFECTED' | 'ERROR';
  }): Promise<boolean>;
}

interface AssetScanDependencies {
  now?: () => Date;
  repository: AssetScanRepository;
  storage: { deleteObject(key: string): Promise<void> };
}

export class ScanResultNotFoundError extends Error {
  constructor() {
    super('Asset was not found.');
    this.name = 'ScanResultNotFoundError';
  }
}

export class ScanResultConflictError extends Error {
  constructor() {
    super('Asset cannot accept this scan result.');
    this.name = 'ScanResultConflictError';
  }
}

export function createPrismaAssetScanRepository(
  db: ReturnType<typeof getDb> = getDb(),
): AssetScanRepository {
  return {
    async findById(assetId) {
      return db.asset.findUnique({
        select: {
          id: true,
          kind: true,
          ownerId: true,
          scanStatus: true,
          status: true,
          storageKey: true,
        },
        where: { id: assetId },
      });
    },
    async recordResult({ assetId, from, scannedAt, sha256, status, to }) {
      const updated = await db.asset.updateMany({
        data: {
          scanSha256: sha256,
          scanStatus: to,
          scannedAt,
          ...(status ? { status } : {}),
        },
        where: {
          id: assetId,
          kind: 'RESOURCE_DOCUMENT',
          scanStatus: from,
          status: { in: ['PENDING', 'READY'] },
        },
      });
      return updated.count === 1;
    },
  };
}

function defaultDependencies(): AssetScanDependencies {
  return {
    repository: createPrismaAssetScanRepository(),
    storage: createS3UploadStorage(),
  };
}

export async function recordAssetScanResult(
  input: {
    assetId: string;
    sha256: string;
    verdict: 'CLEAN' | 'INFECTED' | 'ERROR';
  },
  dependencies: AssetScanDependencies = defaultDependencies(),
) {
  const asset = await dependencies.repository.findById(input.assetId);
  if (!asset) throw new ScanResultNotFoundError();
  if (
    asset.kind !== 'RESOURCE_DOCUMENT' ||
    (asset.status !== 'PENDING' && asset.status !== 'READY') ||
    (asset.scanStatus !== 'PENDING' && asset.scanStatus !== 'ERROR')
  ) {
    throw new ScanResultConflictError();
  }

  const infected = input.verdict === 'INFECTED';
  const updated = await dependencies.repository.recordResult({
    assetId: asset.id,
    from: asset.scanStatus,
    scannedAt: (dependencies.now ?? (() => new Date()))(),
    sha256: input.sha256,
    ...(infected ? { status: 'REJECTED' as const } : {}),
    to: input.verdict,
  });
  if (!updated) throw new ScanResultConflictError();

  if (infected) {
    // The database is rejected first, so a storage outage cannot expose the
    // object. Failed deletion is retried by operational cleanup.
    await dependencies.storage.deleteObject(asset.storageKey).catch(() => {});
  }
  return { assetId: asset.id, scanStatus: input.verdict };
}
