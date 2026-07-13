import { describe, expect, it, vi } from 'vitest';

import { StorageObjectNotFoundError } from '@/lib/storage/client';
import {
  processDueStorageDeletions,
  processStorageDeletionJob,
  type StorageDeletionAdapter,
} from '@/lib/storage/deletion-jobs';

const now = new Date('2026-07-14T00:00:00.000Z');

function adapter(job: Record<string, unknown> | null = {}) {
  const record =
    job === null
      ? null
      : {
          attempts: 0,
          id: 'job_1',
          nextAttempt: new Date('2026-07-13T00:00:00.000Z'),
          storageKey: 'announcements/admin_1/asset_1',
          ...job,
        };
  const value = {
    storageDeletionJob: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => record),
      findMany: vi.fn(async () => (record ? [record] : [])),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  return value as unknown as StorageDeletionAdapter;
}

describe('storage deletion jobs', () => {
  it('deletes the object and compare-deletes the completed job', async () => {
    const db = adapter();
    const storage = { deleteObject: vi.fn(async () => undefined) };
    await expect(
      processStorageDeletionJob(db, storage, 'job_1', () => now),
    ).resolves.toEqual({ status: 'deleted' });
    expect(storage.deleteObject).toHaveBeenCalledWith(
      'announcements/admin_1/asset_1',
    );
    expect(db.storageDeletionJob.deleteMany).toHaveBeenCalledWith({
      where: {
        attempts: 0,
        id: 'job_1',
        nextAttempt: new Date('2026-07-13T00:00:00.000Z'),
      },
    });
  });

  it('treats an absent job and an already-missing object as idempotent success', async () => {
    await expect(
      processStorageDeletionJob(
        adapter(null),
        { deleteObject: vi.fn() },
        'missing',
        () => now,
      ),
    ).resolves.toEqual({ status: 'missing' });

    const db = adapter();
    await expect(
      processStorageDeletionJob(
        db,
        {
          deleteObject: vi.fn(async () => {
            throw new StorageObjectNotFoundError();
          }),
        },
        'job_1',
        () => now,
      ),
    ).resolves.toEqual({ status: 'deleted' });
    expect(db.storageDeletionJob.deleteMany).toHaveBeenCalledOnce();
  });

  it('keeps failures queued with a bounded non-sensitive error and capped backoff', async () => {
    const db = adapter({ attempts: 999 });
    const storage = {
      deleteObject: vi.fn(async () => {
        throw new Error(
          'secret=abc storageKey=announcements/admin_1/asset_1 '.repeat(10),
        );
      }),
    };
    await expect(
      processStorageDeletionJob(db, storage, 'job_1', () => now),
    ).resolves.toEqual({ status: 'retry' });
    const update = vi.mocked(db.storageDeletionJob.updateMany).mock
      .calls[0]![0];
    expect(update.where).toMatchObject({ attempts: 999, id: 'job_1' });
    expect(update.data.attempts).toEqual({ increment: 1 });
    expect(String(update.data.lastError)).not.toContain('secret');
    expect(String(update.data.lastError).length).toBeLessThanOrEqual(200);
    expect(update.data.nextAttempt).toEqual(
      new Date('2026-07-15T00:00:00.000Z'),
    );
  });

  it('loads a bounded due batch in stable order and returns safe counts', async () => {
    const db = adapter();
    const result = await processDueStorageDeletions(db, {
      batchSize: 500,
      clock: () => now,
      storage: { deleteObject: vi.fn(async () => undefined) },
    });
    expect(db.storageDeletionJob.findMany).toHaveBeenCalledWith({
      orderBy: [{ nextAttempt: 'asc' }, { id: 'asc' }],
      select: {
        attempts: true,
        id: true,
        nextAttempt: true,
        storageKey: true,
      },
      take: 100,
      where: { nextAttempt: { lte: now } },
    });
    expect(result).toEqual({ deleted: 1, missing: 0, retried: 0 });
  });

  it('falls back to the default batch size for non-finite input', async () => {
    const db = adapter(null);
    await processDueStorageDeletions(db, {
      batchSize: Number.POSITIVE_INFINITY,
      clock: () => now,
      storage: { deleteObject: vi.fn() },
    });
    expect(db.storageDeletionJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });
});
