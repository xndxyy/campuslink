import { describe, expect, it, vi } from 'vitest';

import {
  cleanupRunScopedPublisher,
  type CleanupQueryResult,
  type PublisherCleanupClient,
  type PublisherCleanupPool,
  type PublisherCleanupStorage,
} from '@/tests/helpers/publish-content-cleanup';
import { createPublishContentRunTags } from '@/tests/helpers/publish-content-run-tags';

function result(
  rows: Array<Record<string, unknown>> = [],
  rowCount: number | null = rows.length,
): CleanupQueryResult {
  return { rowCount, rows };
}

type AuditSubject = {
  action: string;
  actorId: string;
  subjectId: string;
  subjectType: string;
};

function cleanupHarness(
  storageKeys = ['asset/a.pdf'],
  options: {
    auditDeleteCount?: number;
    auditSubjects?: AuditSubject[];
  } = {},
) {
  const events: string[] = [];
  const clientQuery = vi.fn(
    async (sql: string, values?: unknown[]): Promise<CleanupQueryResult> => {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (
        normalized === 'BEGIN' ||
        normalized === 'COMMIT' ||
        normalized === 'ROLLBACK'
      ) {
        events.push(`client:${normalized}`);
        return result();
      }
      if (normalized.includes('INSERT INTO "StorageDeletionJob"')) {
        const storageKey = String(values?.[1]);
        events.push(`queue:${storageKey}`);
        return result([{ id: String(values?.[0]), storageKey }], 1);
      }
      if (normalized.includes('DELETE FROM "User"')) {
        events.push('client:delete-user');
        return result([], 1);
      }
      if (normalized.includes('DELETE FROM "AuditLog"')) {
        events.push(`client:delete-audit:${values?.join(':')}`);
        return result([], options.auditDeleteCount ?? 0);
      }
      if (normalized.includes('SELECT COUNT(*)::int AS count')) {
        return result([{ count: 0 }], 1);
      }
      if (normalized.includes('DELETE FROM "TagDefinition"')) {
        events.push(`client:delete-tag:${String(values?.[1])}`);
        return result([], 0);
      }
      throw new Error(`Unexpected client query: ${normalized}`);
    },
  );
  const client: PublisherCleanupClient = {
    query: clientQuery,
    release: vi.fn(() => {
      events.push('client:release');
    }),
  };
  const poolQuery = vi.fn(
    async (sql: string, values?: unknown[]): Promise<CleanupQueryResult> => {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('SELECT "storageKey" FROM "Asset"')) {
        events.push('pool:assets');
        return result(storageKeys.map((storageKey) => ({ storageKey })));
      }
      if (normalized.includes('DELETE FROM "StorageDeletionJob"')) {
        events.push(`pool:delete-job:${String(values?.[1])}`);
        return result([], 1);
      }
      throw new Error(`Unexpected pool query: ${normalized}`);
    },
  );
  const db: PublisherCleanupPool = {
    connect: vi.fn(async () => {
      events.push('pool:connect');
      return client;
    }),
    end: vi.fn(async () => {
      events.push('pool:end');
    }),
    query: poolQuery,
  };
  const storage: PublisherCleanupStorage = {
    deleteObject: vi.fn(async (storageKey: string) => {
      events.push(`storage:delete:${storageKey}`);
    }),
    destroy: vi.fn(() => {
      events.push('storage:destroy');
    }),
  };
  const publisher = {
    ...(options.auditSubjects ? { auditSubjects: options.auditSubjects } : {}),
    campusId: 'campus_1',
    customTags: createPublishContentRunTags(
      '12345678-abcd-4abc-8abc-1234567890ab',
    ),
    id: 'publisher_1',
  };
  let id = 0;
  const cleanup = () =>
    cleanupRunScopedPublisher(publisher, {
      createId: () => `deletion_job_${++id}`,
      db,
      storage,
    });
  return {
    cleanup,
    client,
    clientQuery,
    db,
    events,
    poolQuery,
    storage,
  };
}

describe('run-scoped publisher cleanup', () => {
  const auditSubject = {
    action: 'CAMPUS_WORK_CONTACT_VIEWED',
    actorId: 'viewer_1',
    subjectId: 'work_1',
    subjectType: 'JOB_POST',
  };

  it('queues keys in the transaction and deletes objects only after commit', async () => {
    const harness = cleanupHarness();

    await harness.cleanup();

    expect(harness.events.indexOf('client:COMMIT')).toBeLessThan(
      harness.events.indexOf('storage:delete:asset/a.pdf'),
    );
    expect(harness.events).toContain('queue:asset/a.pdf');
    expect(harness.events).toContain('pool:delete-job:asset/a.pdf');
  });

  it('closes storage and the pool when the asset query fails', async () => {
    const harness = cleanupHarness();
    vi.mocked(harness.db.query).mockRejectedValueOnce(
      new Error('asset query failed'),
    );

    await expect(harness.cleanup()).rejects.toBeInstanceOf(AggregateError);

    expect(harness.db.connect).not.toHaveBeenCalled();
    expect(harness.storage.deleteObject).not.toHaveBeenCalled();
    expect(harness.storage.destroy).toHaveBeenCalledOnce();
    expect(harness.db.end).toHaveBeenCalledOnce();
  });

  it('does not delete objects and still closes resources when connect fails', async () => {
    const harness = cleanupHarness();
    vi.mocked(harness.db.connect).mockRejectedValueOnce(
      new Error('connect failed'),
    );

    await expect(harness.cleanup()).rejects.toBeInstanceOf(AggregateError);

    expect(harness.storage.deleteObject).not.toHaveBeenCalled();
    expect(harness.storage.destroy).toHaveBeenCalledOnce();
    expect(harness.db.end).toHaveBeenCalledOnce();
  });

  it('rolls back transaction failures without deleting queued objects', async () => {
    const harness = cleanupHarness();
    harness.clientQuery.mockImplementationOnce(async (sql: string) => {
      expect(sql).toBe('BEGIN');
      return result();
    });
    harness.clientQuery.mockRejectedValueOnce(new Error('queue failed'));

    await expect(harness.cleanup()).rejects.toBeInstanceOf(AggregateError);

    expect(harness.clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(harness.storage.deleteObject).not.toHaveBeenCalled();
    expect(harness.client.release).toHaveBeenCalledOnce();
    expect(harness.storage.destroy).toHaveBeenCalledOnce();
    expect(harness.db.end).toHaveBeenCalledOnce();
  });

  it('runs every close operation and reports a pool end failure', async () => {
    const harness = cleanupHarness();
    vi.mocked(harness.db.end).mockImplementationOnce(async () => {
      harness.events.push('pool:end-failed');
      throw new Error('end failed');
    });

    await expect(harness.cleanup()).rejects.toBeInstanceOf(AggregateError);

    expect(harness.client.release).toHaveBeenCalledOnce();
    expect(harness.storage.destroy).toHaveBeenCalledOnce();
    expect(harness.db.end).toHaveBeenCalledOnce();
  });

  it('clears successful jobs, retains failed jobs, and reports partial S3 failure', async () => {
    const harness = cleanupHarness(['asset/a.pdf', 'asset/b.pdf']);
    vi.mocked(harness.storage.deleteObject).mockImplementation(
      async (storageKey: string) => {
        harness.events.push(`storage:delete:${storageKey}`);
        if (storageKey === 'asset/b.pdf') throw new Error('S3 failed');
      },
    );

    await expect(harness.cleanup()).rejects.toBeInstanceOf(AggregateError);

    expect(harness.events).toContain('pool:delete-job:asset/a.pdf');
    expect(harness.events).not.toContain('pool:delete-job:asset/b.pdf');
    expect(harness.events.indexOf('client:COMMIT')).toBeLessThan(
      harness.events.indexOf('storage:delete:asset/a.pdf'),
    );
    expect(harness.storage.destroy).toHaveBeenCalledOnce();
    expect(harness.db.end).toHaveBeenCalledOnce();
  });

  it.each([0, 1])(
    'accepts %i exact audit rows during partial or completed E2E cleanup',
    async (auditDeleteCount) => {
      const harness = cleanupHarness([], {
        auditDeleteCount,
        auditSubjects: [auditSubject],
      });

      await harness.cleanup();

      expect(harness.clientQuery).toHaveBeenCalledWith(
        expect.stringMatching(/DELETE FROM "AuditLog"/),
        [
          'campus_1',
          auditSubject.action,
          auditSubject.subjectType,
          auditSubject.subjectId,
          auditSubject.actorId,
        ],
      );
      expect(harness.events).toContain('client:COMMIT');
    },
  );

  it('rolls back when exact audit cleanup would delete more than one row', async () => {
    const harness = cleanupHarness([], {
      auditDeleteCount: 2,
      auditSubjects: [auditSubject],
    });

    await expect(harness.cleanup()).rejects.toBeInstanceOf(AggregateError);

    expect(harness.events).toContain('client:ROLLBACK');
    expect(harness.events).not.toContain('client:COMMIT');
    expect(harness.storage.deleteObject).not.toHaveBeenCalled();
  });
});
