import { describe, expect, it, vi } from 'vitest';

import {
  dismissReport,
  listModerationContent,
  listModerationReports,
  listPendingContent,
  moderateContent,
  ModerationConflictError,
  ModerationForbiddenError,
  ModerationValidationError,
  resolveReport,
  triageReport,
  type ModerationAdapter,
} from '@/lib/domain/moderation';

const moderator = {
  campusId: 'campus_1',
  id: 'moderator_1',
  role: 'MODERATOR' as const,
};

function adapter(
  options: { contentCount?: number; reportCount?: number } = {},
) {
  const value = {
    $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation(value),
    ),
    auditLog: {
      create: vi.fn(async ({ data }) => ({ id: 'audit_1', ...data })),
    },
    contentAssessment: {
      findMany: vi.fn(async () => []),
    },
    forumComment: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: options.contentCount ?? 1 })),
    },
    forumPost: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: options.contentCount ?? 1 })),
    },
    jobPost: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: options.contentCount ?? 1 })),
    },
    marketplaceItem: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: options.contentCount ?? 1 })),
    },
    moderationAction: {
      create: vi.fn(async ({ data }) => ({ id: 'action_1', ...data })),
      findMany: vi.fn(async () => []),
    },
    report: {
      findFirst: vi.fn(async () => ({
        id: 'report_1',
        status: 'TRIAGED',
        targetId: 'resource_1',
        targetType: 'RESOURCE',
      })),
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: options.reportCount ?? 1 })),
    },
    resource: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: options.contentCount ?? 1 })),
    },
  };
  return value as unknown as ModerationAdapter;
}

describe('audited content moderation', () => {
  it.each([
    ['APPROVE', 'PENDING', 'PUBLISHED', 'CONTENT_APPROVED'],
    ['REJECT', 'PENDING', 'REJECTED', 'CONTENT_REJECTED'],
    ['HIDE', 'PUBLISHED', 'HIDDEN', 'CONTENT_HIDDEN'],
    ['RESTORE', 'HIDDEN', 'PUBLISHED', 'CONTENT_RESTORED'],
  ] as const)(
    '%s conditionally changes state and writes immutable action plus audit',
    async (action, currentStatus, nextStatus, event) => {
      const db = adapter();
      await moderateContent(db, moderator, {
        action,
        reason: 'Reviewed against the campus publishing policy.',
        subjectId: 'resource_1',
        subjectType: 'RESOURCE',
      });

      expect(db.resource.updateMany).toHaveBeenCalledWith({
        data: { status: nextStatus },
        where: {
          campusId: moderator.campusId,
          id: 'resource_1',
          status: currentStatus,
        },
      });
      expect(db.moderationAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action,
          actorId: moderator.id,
          reason: 'Reviewed against the campus publishing policy.',
          subjectId: 'resource_1',
          subjectType: 'RESOURCE',
        }),
      });
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: event,
          actorId: moderator.id,
          campusId: moderator.campusId,
          subjectId: 'resource_1',
          subjectType: 'RESOURCE',
        }),
      });
    },
  );

  it('rolls back to a conflict when the exact status predicate loses a race', async () => {
    const db = adapter({ contentCount: 0 });
    await expect(
      moderateContent(db, moderator, {
        action: 'APPROVE',
        reason: 'Meets the publishing policy.',
        subjectId: 'resource_1',
        subjectType: 'RESOURCE',
      }),
    ).rejects.toBeInstanceOf(ModerationConflictError);
    expect(db.moderationAction.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('atomically refuses to publish a resource unless every document is clean', async () => {
    const db = adapter();
    await moderateContent(
      db,
      moderator,
      {
        action: 'APPROVE',
        reason: 'Reviewed against the campus publishing policy.',
        subjectId: 'resource_1',
        subjectType: 'RESOURCE',
      },
      { requireCleanDocuments: true },
    );

    expect(db.resource.updateMany).toHaveBeenCalledWith({
      data: { status: 'PUBLISHED' },
      where: {
        assets: {
          none: {
            kind: 'RESOURCE_DOCUMENT',
            scanStatus: { not: 'CLEAN' },
          },
          some: {
            kind: 'RESOURCE_DOCUMENT',
            scanStatus: 'CLEAN',
            status: 'READY',
          },
        },
        campusId: moderator.campusId,
        id: 'resource_1',
        status: 'PENDING',
      },
    });
  });

  it('applies the same clean-document gate when restoring hidden resources', async () => {
    const db = adapter();
    await moderateContent(
      db,
      moderator,
      {
        action: 'RESTORE',
        reason: 'The corrected resource is ready for publication.',
        subjectId: 'resource_1',
        subjectType: 'RESOURCE',
      },
      { requireCleanDocuments: true },
    );
    expect(db.resource.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assets: expect.any(Object),
          status: 'HIDDEN',
        }),
      }),
    );
  });

  it('requires a trimmed decision reason between 5 and 1000 characters', async () => {
    const db = adapter();
    await expect(
      moderateContent(db, moderator, {
        action: 'REJECT',
        reason: ' no ',
        subjectId: 'resource_1',
        subjectType: 'RESOURCE',
      }),
    ).rejects.toBeInstanceOf(ModerationValidationError);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('denies students before querying target existence', async () => {
    const db = adapter();
    await expect(
      moderateContent(
        db,
        { ...moderator, role: 'STUDENT' },
        {
          action: 'HIDE',
          reason: 'Violates the campus publishing policy.',
          subjectId: 'resource_1',
          subjectType: 'RESOURCE',
        },
      ),
    ).rejects.toBeInstanceOf(ModerationForbiddenError);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('lists oldest pending content with safe author and READY asset metadata', async () => {
    const db = adapter();
    await listPendingContent(db, moderator);
    expect(db.resource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: expect.objectContaining({
          assets: {
            select: {
              contentType: true,
              id: true,
              kind: true,
              sizeBytes: true,
            },
            where: { status: 'READY' },
          },
          author: { select: { id: true, name: true } },
        }),
        where: { campusId: moderator.campusId, status: 'PENDING' },
      }),
    );
    expect(
      JSON.stringify(vi.mocked(db.resource.findMany).mock.calls),
    ).not.toContain('email');
  });

  it('includes forum content and enriches the queue with the latest AI assessment', async () => {
    const db = adapter();
    vi.mocked(db.resource.findMany).mockResolvedValue([
      {
        createdAt: new Date('2026-07-14T09:00:00Z'),
        id: 'resource_1',
        status: 'PENDING',
        title: 'Algorithms notes',
      },
    ]);
    vi.mocked(db.forumPost.findMany).mockResolvedValue([
      {
        author: { id: 'user_1', name: '同学甲' },
        body: '需要人工审核的论坛正文。',
        createdAt: new Date('2026-07-14T10:00:00Z'),
        id: 'post_1',
        kind: 'DISCUSSION',
        status: 'PENDING',
        title: '论坛主题',
      },
    ]);
    vi.mocked(db.forumComment.findMany).mockResolvedValue([
      {
        author: { id: 'user_2', name: '同学乙' },
        body: '需要人工审核的评论。',
        createdAt: new Date('2026-07-14T11:00:00Z'),
        id: 'comment_1',
        post: { id: 'post_1', title: '论坛主题' },
        status: 'PENDING',
      },
    ]);
    vi.mocked(db.contentAssessment.findMany).mockResolvedValue([
      {
        adminSignals: ['疑似站外引流'],
        categories: ['广告垃圾'],
        createdAt: new Date('2026-07-14T10:01:00Z'),
        decision: 'REVIEW',
        id: 'assessment_2',
        model: 'moderation-model',
        providerStatus: 'COMPLETED',
        reasonZh: '内容可能包含推广信息',
        riskScore: 58,
        suggestionZh: '删除站外推广后重新提交',
        targetId: 'post_1',
        targetType: 'FORUM_POST',
      },
    ]);

    const items = await listPendingContent(db, { ...moderator, role: 'ADMIN' });

    expect(items.map((item) => item.subjectType)).toEqual([
      'RESOURCE',
      'FORUM_POST',
      'FORUM_COMMENT',
    ]);
    expect(items[1]).toMatchObject({
      assessment: {
        adminSignals: ['疑似站外引流'],
        decision: 'REVIEW',
        providerStatus: 'COMPLETED',
        riskScore: 58,
      },
      subjectType: 'FORUM_POST',
    });
    expect(db.contentAssessment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        where: expect.objectContaining({ campusId: moderator.campusId }),
      }),
    );
  });

  it('removes admin-only AI signals from the moderator queue', async () => {
    const db = adapter();
    vi.mocked(db.forumPost.findMany).mockResolvedValue([
      {
        createdAt: new Date('2026-07-14T10:00:00Z'),
        id: 'post_1',
        status: 'PENDING',
        title: '论坛主题',
      },
    ]);
    vi.mocked(db.contentAssessment.findMany).mockResolvedValue([
      {
        adminSignals: ['仅管理员可见'],
        createdAt: new Date('2026-07-14T10:01:00Z'),
        decision: 'REVIEW',
        id: 'assessment_1',
        providerStatus: 'COMPLETED',
        targetId: 'post_1',
        targetType: 'FORUM_POST',
      },
    ]);

    const items = await listPendingContent(db, moderator);

    expect(items[0]?.assessment).not.toHaveProperty('adminSignals');
  });

  it('uses custom-tag outcomes and skipped state when enriching parent content', async () => {
    const db = adapter();
    vi.mocked(db.resource.findMany).mockResolvedValue([
      {
        createdAt: new Date('2026-07-14T09:00:00Z'),
        id: 'resource_1',
        status: 'PENDING',
        title: 'Algorithms notes',
      },
    ]);
    vi.mocked(db.contentAssessment.findMany).mockResolvedValue([
      {
        adminSignals: [],
        categories: [],
        createdAt: new Date('2026-07-14T09:03:00Z'),
        decision: 'PASS',
        id: 'assessment_tag_skipped',
        providerStatus: 'SKIPPED',
        targetId: 'resource_1:tag:1',
        targetType: 'CUSTOM_TAG',
      },
      {
        adminSignals: ['标签需要人工确认'],
        categories: ['广告垃圾'],
        createdAt: new Date('2026-07-14T09:02:00Z'),
        decision: 'REVIEW',
        id: 'assessment_tag_review',
        providerStatus: 'COMPLETED',
        reasonZh: '自定义标签可能包含推广信息',
        riskScore: 58,
        targetId: 'resource_1:tag:0',
        targetType: 'CUSTOM_TAG',
      },
      {
        adminSignals: [],
        categories: [],
        createdAt: new Date('2026-07-14T09:01:00Z'),
        decision: 'PASS',
        id: 'assessment_main_pass',
        providerStatus: 'COMPLETED',
        riskScore: 2,
        targetId: 'resource_1',
        targetType: 'RESOURCE',
      },
    ]);

    const items = await listModerationContent(
      db,
      { ...moderator, role: 'ADMIN' },
      { providerStatus: 'SKIPPED', status: 'PENDING' },
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      assessment: {
        decision: 'REVIEW',
        id: 'assessment_tag_review',
        targetType: 'CUSTOM_TAG',
      },
      hasSkippedAssessment: true,
      subjectType: 'RESOURCE',
    });
    expect(db.contentAssessment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ targetType: 'CUSTOM_TAG' }),
          ]),
        }),
      }),
    );
  });

  it('moderates a forum comment through its parent campus boundary', async () => {
    const db = adapter();

    await moderateContent(db, moderator, {
      action: 'APPROVE',
      reason: '评论内容符合校园社区规范。',
      subjectId: 'comment_1',
      subjectType: 'FORUM_COMMENT',
    });

    expect(db.forumComment.updateMany).toHaveBeenCalledWith({
      data: { status: 'PUBLISHED' },
      where: {
        id: 'comment_1',
        post: { campusId: moderator.campusId },
        status: 'PENDING',
      },
    });
  });
});

describe('report resolution', () => {
  it('lists only the staff actor campus and attaches safe prior action history', async () => {
    const db = adapter();
    vi.mocked(db.report.findMany).mockResolvedValue([
      {
        createdAt: new Date('2026-07-12T10:00:00Z'),
        id: 'report_1',
        reason: 'SPAM',
        status: 'TRIAGED',
        targetId: 'resource_1',
        targetType: 'RESOURCE',
      },
    ]);
    await listModerationReports(db, moderator);
    expect(db.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          campusId: moderator.campusId,
          status: { in: ['OPEN', 'TRIAGED'] },
        },
      }),
    );
    expect(
      (db.moderationAction as unknown as { findMany: ReturnType<typeof vi.fn> })
        .findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ reason: false }),
        where: expect.objectContaining({
          subjectId: { in: ['report_1', 'resource_1'] },
        }),
      }),
    );
  });

  it('triages only OPEN reports in the staff campus', async () => {
    const db = adapter();
    await triageReport(db, moderator, {
      reason: 'Initial review assigns this report to the moderator.',
      reportId: 'report_1',
    });
    expect(db.report.updateMany).toHaveBeenCalledWith({
      data: { assigneeId: moderator.id, status: 'TRIAGED' },
      where: {
        campusId: moderator.campusId,
        id: 'report_1',
        status: 'OPEN',
      },
    });
  });

  it('dismisses only TRIAGED reports in the staff campus', async () => {
    const db = adapter();
    await dismissReport(db, moderator, {
      reason: 'Completed review found no policy violation.',
      reportId: 'report_1',
    });
    expect(db.report.updateMany).toHaveBeenCalledWith({
      data: { assigneeId: moderator.id, status: 'DISMISSED' },
      where: {
        campusId: moderator.campusId,
        id: 'report_1',
        status: 'TRIAGED',
      },
    });
  });

  it('returns a conflict for a repeated triage or concurrent report transition', async () => {
    const db = adapter({ reportCount: 0 });
    await expect(
      triageReport(db, moderator, {
        reason: 'Repeated review must lose the exact status race.',
        reportId: 'report_1',
      }),
    ).rejects.toBeInstanceOf(ModerationConflictError);
    expect(db.moderationAction.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('atomically resolves a triaged report, hides a published target, and audits both', async () => {
    const db = adapter();
    await resolveReport(db, moderator, {
      hideTarget: true,
      reason: 'Confirmed prohibited content after review.',
      reportId: 'report_1',
    });
    expect(db.resource.updateMany).toHaveBeenCalledWith({
      data: { status: 'HIDDEN' },
      where: {
        campusId: moderator.campusId,
        id: 'resource_1',
        status: 'PUBLISHED',
      },
    });
    expect(db.report.updateMany).toHaveBeenCalledWith({
      data: { assigneeId: moderator.id, status: 'RESOLVED' },
      where: {
        campusId: moderator.campusId,
        id: 'report_1',
        status: 'TRIAGED',
      },
    });
    expect(db.report.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          campusId: moderator.campusId,
          id: 'report_1',
          status: 'TRIAGED',
        },
      }),
    );
    expect(db.moderationAction.create).toHaveBeenCalledTimes(2);
    expect(db.auditLog.create).toHaveBeenCalledTimes(2);
  });

  it('denies direct OPEN to RESOLVED transitions without writing history', async () => {
    const db = adapter();
    vi.mocked(db.report.findFirst).mockResolvedValue(null);
    await expect(
      resolveReport(db, moderator, {
        hideTarget: false,
        reason: 'A report must be triaged before final resolution.',
        reportId: 'report_1',
      }),
    ).rejects.toBeInstanceOf(ModerationConflictError);
    expect(db.report.updateMany).not.toHaveBeenCalled();
    expect(db.moderationAction.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('does not create logs if the report status loses a race', async () => {
    const db = adapter({ reportCount: 0 });
    await expect(
      resolveReport(db, moderator, {
        hideTarget: false,
        reason: 'Review completed with a documented outcome.',
        reportId: 'report_1',
      }),
    ).rejects.toBeInstanceOf(ModerationConflictError);
    expect(db.moderationAction.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
});
