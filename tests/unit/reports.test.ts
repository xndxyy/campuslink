import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  createReport,
  listReporterReports,
  ReportDuplicateError,
  ReportNotFoundError,
  ReportOwnContentError,
  type ReportsAdapter,
} from '@/lib/domain/reports';
import {
  fingerprintAnonymousUser,
  type AnonymousIdentityKeyring,
} from '@/lib/security/anonymous-identity';

const actor = {
  campusId: 'campus_1',
  emailVerifiedAt: new Date('2026-07-14T08:00:00Z'),
  id: 'user_1',
  status: 'ACTIVE' as const,
};
const keys: AnonymousIdentityKeyring = {
  currentVersion: 1,
  encryptionKeys: new Map([[1, Buffer.alloc(32, 0x41)]]),
  fingerprintKey: Buffer.alloc(32, 0x42),
};
const input = {
  details: 'This listing redirects students to a suspicious payment page.',
  reason: 'PROHIBITED' as const,
  targetId: 'market_1',
  targetType: 'MARKETPLACE_ITEM' as const,
};

function adapter(ownerId = 'seller_1') {
  const value = {
    $queryRawUnsafe: vi.fn(async (query: string, ...values: unknown[]) =>
      query.includes('FROM "ForumPost"')
        ? [{ campusId: values[1], id: values[0] }]
        : [{ id: values[0], postId: values[1] }],
    ),
    $transaction: vi.fn(
      async (
        operation: (tx: unknown) => Promise<unknown>,
        options?: { isolationLevel: 'Serializable' },
      ) => {
        void options;
        return operation(value);
      },
    ),
    forumComment: { findFirst: vi.fn(async () => null) },
    forumPost: { findFirst: vi.fn(async () => null) },
    campusWorkPost: { findFirst: vi.fn(async () => null) },
    marketplaceItem: {
      findFirst: vi.fn(async () => ({ sellerId: ownerId })),
    },
    report: {
      create: vi.fn(async () => ({
        createdAt: new Date('2026-07-12T12:00:00Z'),
        id: 'report_1',
        status: 'OPEN',
      })),
      findMany: vi.fn(async () => []),
    },
    resource: { findFirst: vi.fn(async () => null) },
  };
  return value as unknown as ReportsAdapter;
}

describe('reports domain', () => {
  it('rejects reporting own content with the exact message', async () => {
    await expect(createReport(adapter(actor.id), actor, input)).rejects.toEqual(
      new ReportOwnContentError(),
    );
    await expect(createReport(adapter(actor.id), actor, input)).rejects.toThrow(
      'Cannot report own content',
    );
  });

  it('denies hidden, unpublished, missing, or cross-campus targets', async () => {
    const db = adapter();
    vi.mocked(db.marketplaceItem.findFirst).mockResolvedValue(null);
    await expect(createReport(db, actor, input)).rejects.toBeInstanceOf(
      ReportNotFoundError,
    );
    expect(db.report.create).not.toHaveBeenCalled();
  });

  it('creates an OPEN report without accepting owner, status, or assignee', async () => {
    const db = adapter();
    await createReport(db, actor, input);
    expect(db.report.create).toHaveBeenCalledWith({
      data: {
        campusId: actor.campusId,
        details: input.details,
        reason: input.reason,
        reporterId: actor.id,
        status: 'OPEN',
        targetId: input.targetId,
        targetType: input.targetType,
      },
      select: { createdAt: true, id: true, status: true },
    });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it.each([
    { code: 'P2002' },
    { code: '23505', constraint: 'Report_open_unique' },
  ])('maps duplicate OPEN report races to a conflict', async (error) => {
    const db = adapter();
    vi.mocked(db.report.create).mockRejectedValue(error);
    await expect(createReport(db, actor, input)).rejects.toBeInstanceOf(
      ReportDuplicateError,
    );
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it.each([{ code: 'P2034' }, { code: '40001' }, { meta: { code: '40001' } }])(
    'retries the complete locked report transaction after %#',
    async (failure) => {
      const db = adapter();
      vi.mocked(db.forumPost.findFirst).mockResolvedValue({
        authorId: 'other_user',
        campusId: actor.campusId,
        id: 'post_1',
        kind: 'DISCUSSION',
        status: 'PUBLISHED',
      });
      vi.mocked(db.$transaction)
        .mockImplementationOnce(async (operation) => {
          await operation(db);
          throw failure;
        })
        .mockImplementationOnce(async (operation) => operation(db));

      await createReport(db, actor, {
        reason: 'SPAM',
        targetId: 'post_1',
        targetType: 'FORUM_POST',
      });

      expect(db.$transaction).toHaveBeenCalledTimes(2);
      expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(2);
      expect(db.forumPost.findFirst).toHaveBeenCalledTimes(4);
      expect(db.report.create).toHaveBeenCalledTimes(2);
      for (const [, options] of vi.mocked(db.$transaction).mock.calls) {
        expect(options).toStrictEqual({ isolationLevel: 'Serializable' });
      }
    },
  );

  it('revalidates locks after conflict and returns NotFound when the target disappeared', async () => {
    const db = adapter();
    vi.mocked(db.forumPost.findFirst).mockResolvedValue({
      authorId: 'other_user',
      campusId: actor.campusId,
      id: 'post_1',
      kind: 'DISCUSSION',
      status: 'PUBLISHED',
    });
    vi.mocked(db.$queryRawUnsafe)
      .mockResolvedValueOnce([{ campusId: actor.campusId, id: 'post_1' }])
      .mockResolvedValueOnce([]);
    vi.mocked(db.$transaction)
      .mockImplementationOnce(async (operation) => {
        await operation(db);
        throw { code: 'P2034' };
      })
      .mockImplementationOnce(async (operation) => operation(db));

    await expect(
      createReport(db, actor, {
        reason: 'SPAM',
        targetId: 'post_1',
        targetType: 'FORUM_POST',
      }),
    ).rejects.toBeInstanceOf(ReportNotFoundError);
    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(2);
    expect(db.report.create).toHaveBeenCalledTimes(1);
  });

  it('rethrows the third serialization failure after reacquiring every lock', async () => {
    const db = adapter();
    const finalFailure = { code: 'P2034', marker: 'third-attempt' };
    vi.mocked(db.forumPost.findFirst).mockResolvedValue({
      authorId: 'other_user',
      campusId: actor.campusId,
      id: 'post_1',
      kind: 'DISCUSSION',
      status: 'PUBLISHED',
    });
    vi.mocked(db.$transaction).mockImplementation(async (operation) => {
      await operation(db);
      throw finalFailure;
    });

    await expect(
      createReport(db, actor, {
        reason: 'SPAM',
        targetId: 'post_1',
        targetType: 'FORUM_POST',
      }),
    ).rejects.toBe(finalFailure);
    expect(db.$transaction).toHaveBeenCalledTimes(3);
    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(3);
    expect(db.report.create).toHaveBeenCalledTimes(3);
  });

  it('returns reporter-safe status and a neutral public outcome only', async () => {
    const db = adapter();
    vi.mocked(db.report.findMany).mockResolvedValue([
      {
        createdAt: new Date('2026-07-12T12:00:00Z'),
        id: 'report_1',
        status: 'TRIAGED',
        targetId: input.targetId,
        targetType: input.targetType,
        updatedAt: new Date('2026-07-12T13:00:00Z'),
      },
    ]);
    const reports = await listReporterReports(db, actor, {
      page: 1,
      pageSize: 10,
    });
    expect(reports.items[0]).toEqual(
      expect.objectContaining({
        outcome: 'Your report is under review.',
        status: 'TRIAGED',
      }),
    );
    expect(reports.items[0]).not.toHaveProperty('assigneeId');
    expect(reports.items[0]).not.toHaveProperty('reason');
    expect(reports.items[0]).not.toHaveProperty('details');
    expect(db.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          campusId: actor.campusId,
          reporterId: actor.id,
        }),
      }),
    );
  });

  it('defensively rejects report writes from an unverified or inactive actor', async () => {
    const db = adapter();
    await expect(
      createReport(db, { ...actor, emailVerifiedAt: null }, input),
    ).rejects.toThrow('A verified active account is required');
    await expect(
      createReport(db, { ...actor, status: 'SUSPENDED' }, input),
    ).rejects.toThrow('A verified active account is required');
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('allows a visible discussion report while selecting no author email', async () => {
    const db = adapter();
    const resolveKeys = vi.fn(() => keys);
    vi.mocked(db.forumPost.findFirst).mockResolvedValue({
      anonymousFingerprint: null,
      authorId: 'other_user',
      campusId: actor.campusId,
      id: 'post_1',
      kind: 'DISCUSSION',
      status: 'PUBLISHED',
    });
    await createReport(
      db,
      actor,
      {
        reason: 'SPAM',
        targetId: 'post_1',
        targetType: 'FORUM_POST',
      },
      resolveKeys,
    );
    expect(resolveKeys).not.toHaveBeenCalled();
    const calls = vi.mocked(db.forumPost.findFirst).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[0]).toHaveProperty('select', {
      campusId: true,
      id: true,
      kind: true,
      status: true,
    });
    const call = calls[1]?.[0];
    expect(call).toHaveProperty('where', {
      campusId: actor.campusId,
      id: 'post_1',
      kind: 'DISCUSSION',
      status: 'PUBLISHED',
    });
    expect(call).toHaveProperty('select.authorId', true);
    expect(JSON.stringify(call)).not.toContain('email');
    expect(JSON.stringify(call)).not.toContain('anonymousFingerprint');
    expect(JSON.stringify(call)).not.toContain('anonymousCiphertext');
    expect(JSON.stringify(call)).not.toContain('anonymousKeyVersion');
    expect(db.$queryRawUnsafe).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FOR KEY SHARE'),
      'post_1',
      actor.campusId,
    );
    expect(
      vi.mocked(db.$queryRawUnsafe).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(db.forumPost.findFirst).mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY,
    );
  });

  it('blocks a tree-hole self-report by fingerprint without decrypting identity', async () => {
    const db = adapter();
    const resolveKeys = vi.fn(() => keys);
    vi.mocked(db.forumPost.findFirst).mockResolvedValue({
      anonymousFingerprint: fingerprintAnonymousUser(actor.id, keys),
      authorId: null,
      campusId: actor.campusId,
      id: 'tree_1',
      kind: 'TREE_HOLE',
      status: 'PUBLISHED',
    });
    await expect(
      createReport(
        db,
        actor,
        {
          reason: 'OTHER',
          targetId: 'tree_1',
          targetType: 'FORUM_POST',
        },
        resolveKeys,
      ),
    ).rejects.toBeInstanceOf(ReportOwnContentError);
    expect(resolveKeys).toHaveBeenCalledTimes(1);
    expect(db.report.create).not.toHaveBeenCalled();
    const calls = vi.mocked(db.forumPost.findFirst).mock.calls;
    expect(calls).toHaveLength(2);
    const serialized = JSON.stringify(calls[1]?.[0]);
    expect(serialized).toContain('anonymousFingerprint');
    expect(serialized).not.toContain('authorId');
    expect(serialized).not.toContain('anonymousCiphertext');
    expect(serialized).not.toContain('anonymousKeyVersion');
  });

  it('rejects a forum-post report when the shared lock row is absent', async () => {
    const db = adapter();
    vi.mocked(db.$queryRawUnsafe).mockResolvedValue([]);
    await expect(
      createReport(
        db,
        actor,
        {
          reason: 'SPAM',
          targetId: 'post_1',
          targetType: 'FORUM_POST',
        },
        keys,
      ),
    ).rejects.toBeInstanceOf(ReportNotFoundError);
    expect(db.forumPost.findFirst).not.toHaveBeenCalled();
    expect(db.report.create).not.toHaveBeenCalled();
  });

  it('rejects a defensive cross-campus, hidden, or wrong-kind forum post record', async () => {
    const db = adapter();
    vi.mocked(db.forumPost.findFirst).mockResolvedValue({
      anonymousFingerprint: null,
      authorId: 'other_user',
      campusId: 'campus_2',
      id: 'post_1',
      kind: 'DISCUSSION',
      status: 'PUBLISHED',
    });
    await expect(
      createReport(
        db,
        actor,
        {
          reason: 'SPAM',
          targetId: 'post_1',
          targetType: 'FORUM_POST',
        },
        keys,
      ),
    ).rejects.toBeInstanceOf(ReportNotFoundError);
  });

  it('validates a forum comment belongs to a visible discussion and blocks self-report', async () => {
    const db = adapter();
    vi.mocked(db.forumComment.findFirst).mockResolvedValue({
      authorId: actor.id,
      id: 'comment_1',
      post: {
        campusId: actor.campusId,
        id: 'post_1',
        kind: 'DISCUSSION',
        status: 'PUBLISHED',
      },
      postId: 'post_1',
      status: 'PUBLISHED',
    });
    await expect(
      createReport(db, actor, {
        reason: 'HARASSMENT',
        targetId: 'comment_1',
        targetType: 'FORUM_COMMENT',
      }),
    ).rejects.toBeInstanceOf(ReportOwnContentError);
    expect(db.report.create).not.toHaveBeenCalled();
    expect(db.forumComment.findFirst).toHaveBeenNthCalledWith(1, {
      select: { postId: true },
      where: { id: 'comment_1' },
    });
    expect(db.$queryRawUnsafe).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM "ForumPost"'),
      'post_1',
      actor.campusId,
    );
    expect(db.$queryRawUnsafe).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM "ForumComment"'),
      'comment_1',
      'post_1',
    );
    expect(
      vi.mocked(db.$queryRawUnsafe).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(db.$queryRawUnsafe).mock.invocationCallOrder[1] ??
        Number.POSITIVE_INFINITY,
    );
  });

  it('rejects a forum comment attached to a tree-hole post', async () => {
    const db = adapter();
    vi.mocked(db.forumComment.findFirst).mockResolvedValue({
      authorId: 'other_user',
      id: 'comment_1',
      post: {
        campusId: actor.campusId,
        id: 'tree_1',
        kind: 'TREE_HOLE',
        status: 'PUBLISHED',
      },
      postId: 'tree_1',
      status: 'PUBLISHED',
    });
    await expect(
      createReport(db, actor, {
        reason: 'HARASSMENT',
        targetId: 'comment_1',
        targetType: 'FORUM_COMMENT',
      }),
    ).rejects.toBeInstanceOf(ReportNotFoundError);
  });

  it('stops a forum-comment report when the parent lock row is absent', async () => {
    const db = adapter();
    vi.mocked(db.forumComment.findFirst).mockResolvedValue({
      postId: 'post_1',
    });
    vi.mocked(db.$queryRawUnsafe).mockResolvedValueOnce([]);
    await expect(
      createReport(db, actor, {
        reason: 'SPAM',
        targetId: 'comment_1',
        targetType: 'FORUM_COMMENT',
      }),
    ).rejects.toBeInstanceOf(ReportNotFoundError);
    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(db.forumComment.findFirst).toHaveBeenCalledTimes(1);
    expect(db.report.create).not.toHaveBeenCalled();
  });

  it('forwards Serializable options through the report-first integration barrier adapter', () => {
    const source = readFileSync('tests/integration/forum.test.ts', 'utf8');
    const adapterSource = source.slice(
      source.indexOf('function reportCreateBarrierAdapter'),
      source.indexOf('function deleteBarrierAdapter'),
    );
    expect(adapterSource).toContain(
      "options?: { isolationLevel: 'Serializable' }",
    );
    expect(adapterSource).toMatch(/client\.\$transaction\([\s\S]*options/);
  });
});
