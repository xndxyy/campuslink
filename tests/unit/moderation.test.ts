import { describe, expect, it, vi } from 'vitest';

import {
  dismissReport,
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
