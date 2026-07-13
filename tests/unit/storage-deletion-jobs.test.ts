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
      findFirst: vi.fn(async ({ where }) => {
        if (!record) return null;
        const due = (where as { nextAttempt?: { lte?: Date } }).nextAttempt
          ?.lte;
        return due && record.nextAttempt > due ? null : record;
      }),
      findMany: vi.fn(async () => (record ? [record] : [])),
      findUnique: vi.fn(async () => (record ? { id: record.id } : null)),
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
    const leaseUntil = new Date('2026-07-14T00:10:00.000Z');
    expect(db.storageDeletionJob.updateMany).toHaveBeenNthCalledWith(1, {
      data: { nextAttempt: leaseUntil },
      where: {
        AND: [
          { nextAttempt: new Date('2026-07-13T00:00:00.000Z') },
          { nextAttempt: { lte: now } },
        ],
        attempts: 0,
        id: 'job_1',
      },
    });
    expect(db.storageDeletionJob.deleteMany).toHaveBeenCalledWith({
      where: {
        attempts: 0,
        id: 'job_1',
        nextAttempt: leaseUntil,
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
      .calls[1]![0];
    expect(update.where).toMatchObject({ attempts: 999, id: 'job_1' });
    expect(update.where.nextAttempt).toEqual(
      new Date('2026-07-14T00:10:00.000Z'),
    );
    expect(update.data.attempts).toEqual({ increment: 1 });
    expect(String(update.data.lastError)).not.toContain('secret');
    expect(String(update.data.lastError).length).toBeLessThanOrEqual(200);
    expect(update.data.nextAttempt).toEqual(
      new Date('2026-07-15T00:00:00.000Z'),
    );
  });

  it('schedules retry backoff from failure completion rather than claim time', async () => {
    const db = adapter();
    const completedAt = new Date('2026-07-14T00:05:00.000Z');
    const clock = vi
      .fn()
      .mockReturnValueOnce(now)
      .mockReturnValueOnce(completedAt);
    await processStorageDeletionJob(
      db,
      {
        deleteObject: vi.fn(async () => {
          throw new Error('private failure');
        }),
      },
      'job_1',
      clock,
    );
    expect(
      vi.mocked(db.storageDeletionJob.updateMany).mock.calls[1]![0].data
        .nextAttempt,
    ).toEqual(new Date('2026-07-14T00:06:00.000Z'));
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
    expect(result).toEqual({ deferred: 0, deleted: 1, missing: 0, retried: 0 });
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

  it('does not call storage while a retry or crash lease is still in the future', async () => {
    const db = adapter({ nextAttempt: new Date('2026-07-14T00:10:00.000Z') });
    const storage = { deleteObject: vi.fn() };
    await expect(
      processStorageDeletionJob(db, storage, 'job_1', () => now),
    ).resolves.toEqual({ status: 'deferred' });
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(db.storageDeletionJob.updateMany).not.toHaveBeenCalled();
  });

  it('lets only one of two deterministic workers claim and call storage', async () => {
    const db = adapter();
    let reads = 0;
    let releaseReads!: () => void;
    const bothRead = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    vi.mocked(db.storageDeletionJob.findFirst).mockImplementation(async () => {
      reads += 1;
      if (reads === 2) releaseReads();
      await bothRead;
      return {
        attempts: 0,
        id: 'job_1',
        nextAttempt: new Date('2026-07-13T00:00:00.000Z'),
        storageKey: 'announcements/admin_1/asset_1',
      };
    });
    let claims = 0;
    vi.mocked(db.storageDeletionJob.updateMany).mockImplementation(
      async ({ data }) => {
        if (Object.keys(data).length === 1 && data.nextAttempt) {
          claims += 1;
          return { count: claims === 1 ? 1 : 0 };
        }
        return { count: 1 };
      },
    );
    const storage = { deleteObject: vi.fn(async () => undefined) };
    const results = await Promise.all([
      processStorageDeletionJob(db, storage, 'job_1', () => now),
      processStorageDeletionJob(db, storage, 'job_1', () => now),
    ]);
    expect(results).toEqual(
      expect.arrayContaining([{ status: 'deleted' }, { status: 'deferred' }]),
    );
    expect(storage.deleteObject).toHaveBeenCalledOnce();
  });

  it('does not falsely report success when completion CAS loses ownership', async () => {
    const db = adapter();
    vi.mocked(db.storageDeletionJob.deleteMany).mockResolvedValue({ count: 0 });
    await expect(
      processStorageDeletionJob(
        db,
        { deleteObject: vi.fn(async () => undefined) },
        'job_1',
        () => now,
      ),
    ).resolves.toEqual({ status: 'deferred' });
  });

  it('does not falsely report retry when the failure CAS loses ownership', async () => {
    const db = adapter();
    vi.mocked(db.storageDeletionJob.updateMany)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await expect(
      processStorageDeletionJob(
        db,
        {
          deleteObject: vi.fn(async () => {
            throw new Error('private failure');
          }),
        },
        'job_1',
        () => now,
      ),
    ).resolves.toEqual({ status: 'deferred' });
  });

  it('does not call storage when the atomic claim loses a stale selection', async () => {
    const db = adapter();
    vi.mocked(db.storageDeletionJob.updateMany).mockResolvedValue({ count: 0 });
    const storage = { deleteObject: vi.fn() };
    await expect(
      processStorageDeletionJob(db, storage, 'job_1', () => now),
    ).resolves.toEqual({ status: 'deferred' });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('allows an expired crash lease to be claimed and processed', async () => {
    const db = adapter({ nextAttempt: new Date('2026-07-13T23:59:59.000Z') });
    const storage = { deleteObject: vi.fn(async () => undefined) };
    await expect(
      processStorageDeletionJob(db, storage, 'job_1', () => now),
    ).resolves.toEqual({ status: 'deleted' });
    expect(storage.deleteObject).toHaveBeenCalledOnce();
  });

  it('counts a stale batch selection as deferred without calling storage', async () => {
    const db = adapter({ nextAttempt: new Date('2026-07-14T00:10:00.000Z') });
    vi.mocked(db.storageDeletionJob.findMany).mockResolvedValue([
      {
        attempts: 0,
        id: 'job_1',
        nextAttempt: new Date('2026-07-13T23:00:00.000Z'),
        storageKey: 'announcements/admin_1/asset_1',
      },
    ]);
    const storage = { deleteObject: vi.fn() };
    await expect(
      processDueStorageDeletions(db, { clock: () => now, storage }),
    ).resolves.toEqual({ deferred: 1, deleted: 0, missing: 0, retried: 0 });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });
});
