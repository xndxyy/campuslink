import 'server-only';

import { createS3UploadStorage, StorageObjectNotFoundError } from './client';

interface StorageDeletionRecord {
  attempts: number;
  id: string;
  nextAttempt: Date;
  storageKey: string;
}

export interface StorageDeletionAdapter {
  storageDeletionJob: {
    deleteMany(args: {
      where: Record<string, unknown>;
    }): Promise<{ count: number }>;
    findFirst(
      args: Record<string, unknown>,
    ): Promise<StorageDeletionRecord | null>;
    findMany(args: Record<string, unknown>): Promise<StorageDeletionRecord[]>;
    updateMany(args: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
}

export interface ObjectDeletionStorage {
  deleteObject(key: string): Promise<void>;
}

export type StorageDeletionResult =
  { status: 'deleted' } | { status: 'missing' } | { status: 'retry' };

const MAX_BATCH_SIZE = 100;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
const INITIAL_BACKOFF_MS = 60 * 1000;
const safeLastError = 'Storage deletion failed.';

function retryAt(now: Date, attempts: number) {
  const exponent = Math.min(Math.max(attempts, 0), 30);
  const delay = Math.min(INITIAL_BACKOFF_MS * 2 ** exponent, MAX_BACKOFF_MS);
  return new Date(now.getTime() + delay);
}

const recordSelect = {
  attempts: true,
  id: true,
  nextAttempt: true,
  storageKey: true,
};

export async function processStorageDeletionJob(
  adapter: StorageDeletionAdapter,
  storage: ObjectDeletionStorage,
  jobId: string,
  clock: () => Date = () => new Date(),
): Promise<StorageDeletionResult> {
  const job = await adapter.storageDeletionJob.findFirst({
    select: recordSelect,
    where: { id: jobId },
  });
  if (!job) return { status: 'missing' };

  try {
    await storage.deleteObject(job.storageKey);
  } catch (error) {
    if (!(error instanceof StorageObjectNotFoundError)) {
      await adapter.storageDeletionJob.updateMany({
        data: {
          attempts: { increment: 1 },
          lastError: safeLastError,
          nextAttempt: retryAt(clock(), job.attempts),
        },
        where: {
          attempts: job.attempts,
          id: job.id,
          nextAttempt: job.nextAttempt,
        },
      });
      return { status: 'retry' };
    }
  }

  await adapter.storageDeletionJob.deleteMany({
    where: {
      attempts: job.attempts,
      id: job.id,
      nextAttempt: job.nextAttempt,
    },
  });
  return { status: 'deleted' };
}

export async function processDueStorageDeletions(
  adapter: StorageDeletionAdapter,
  options: {
    batchSize?: number;
    clock?: () => Date;
    storage?: ObjectDeletionStorage;
  } = {},
) {
  const clock = options.clock ?? (() => new Date());
  const now = clock();
  const requestedBatchSize = Number.isFinite(options.batchSize)
    ? Math.trunc(options.batchSize as number)
    : 50;
  const take = Math.max(1, Math.min(requestedBatchSize, MAX_BATCH_SIZE));
  const storage = options.storage ?? createS3UploadStorage();
  const jobs = await adapter.storageDeletionJob.findMany({
    orderBy: [{ nextAttempt: 'asc' }, { id: 'asc' }],
    select: recordSelect,
    take,
    where: { nextAttempt: { lte: now } },
  });
  const counts = { deleted: 0, missing: 0, retried: 0 };
  for (const job of jobs) {
    const result = await processStorageDeletionJob(
      adapter,
      storage,
      job.id,
      clock,
    );
    if (result.status === 'deleted') counts.deleted += 1;
    else if (result.status === 'missing') counts.missing += 1;
    else counts.retried += 1;
  }
  return counts;
}
