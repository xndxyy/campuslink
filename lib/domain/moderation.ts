import {
  type ContentAdapter,
  purgeContentRecord,
} from '@/lib/domain/content-service';

export type StaffRole = 'STUDENT' | 'MODERATOR' | 'ADMIN';
export type ContentSubjectType =
  'RESOURCE' | 'MARKETPLACE_ITEM' | 'JOB_POST' | 'FORUM_POST' | 'FORUM_COMMENT';
export type ContentModerationAction =
  'APPROVE' | 'REJECT' | 'HIDE' | 'RESTORE' | 'ARCHIVE';
export type ModerationContentStatus =
  'PENDING' | 'PUBLISHED' | 'REJECTED' | 'HIDDEN';

export interface StaffActor {
  campusId: string;
  id: string;
  role: StaffRole;
}

interface ContentDelegate {
  deleteMany(args: {
    where: Record<string, unknown>;
  }): Promise<{ count: number }>;
  findFirst(
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
  findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  updateMany(args: {
    data: Record<string, unknown>;
    where: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

interface CreateDelegate {
  create(args: {
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}

export interface ModerationAdapter {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $transaction<T>(operation: (tx: ModerationAdapter) => Promise<T>): Promise<T>;
  auditLog: CreateDelegate;
  asset: {
    deleteMany(args: {
      where: { id: { in: string[] } };
    }): Promise<{ count: number }>;
  };
  contentAssessment: {
    findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
  campusWorkPost: ContentDelegate;
  forumComment: ContentDelegate;
  forumPost: ContentDelegate;
  favourite: {
    deleteMany(args: {
      where: { targetId: string; targetType: string };
    }): Promise<{ count: number }>;
  };
  marketplaceItem: ContentDelegate;
  moderationAction: CreateDelegate & {
    findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
  report: {
    findFirst(
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown> | null>;
    findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
    updateMany(args: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  resource: ContentDelegate;
  storageDeletionJob: {
    upsert(args: {
      create: { storageKey: string };
      update: Record<string, never>;
      where: { storageKey: string };
    }): Promise<unknown>;
  };
}

export class ModerationForbiddenError extends Error {
  constructor() {
    super('Staff access is required');
  }
}

export class ModerationValidationError extends Error {
  constructor(message = 'Invalid moderation input') {
    super(message);
  }
}

export class ModerationConflictError extends Error {
  constructor(message = 'Moderation state conflict') {
    super(message);
  }
}

function requireStaff(actor: StaffActor) {
  if (actor.role !== 'MODERATOR' && actor.role !== 'ADMIN') {
    throw new ModerationForbiddenError();
  }
}

function decisionReason(reason: string) {
  const value = reason.trim();
  if (value.length < 5 || value.length > 1000) {
    throw new ModerationValidationError(
      'A reason between 5 and 1000 characters is required',
    );
  }
  return value;
}

function contentDelegate(adapter: ModerationAdapter, type: ContentSubjectType) {
  if (type === 'RESOURCE') return adapter.resource;
  if (type === 'MARKETPLACE_ITEM') return adapter.marketplaceItem;
  if (type === 'FORUM_POST') return adapter.forumPost;
  if (type === 'FORUM_COMMENT') return adapter.forumComment;
  return adapter.campusWorkPost;
}

const contentTransitions = {
  APPROVE: {
    event: 'CONTENT_APPROVED',
    from: 'PENDING',
    to: 'PUBLISHED',
  },
  ARCHIVE: {
    event: 'CONTENT_ARCHIVED',
    from: ['PENDING', 'PUBLISHED', 'HIDDEN'],
    to: 'ARCHIVED',
  },
  HIDE: { event: 'CONTENT_HIDDEN', from: 'PUBLISHED', to: 'HIDDEN' },
  REJECT: { event: 'CONTENT_REJECTED', from: 'PENDING', to: 'REJECTED' },
  RESTORE: { event: 'CONTENT_RESTORED', from: 'HIDDEN', to: 'PUBLISHED' },
} as const;

export async function moderateContent(
  adapter: ModerationAdapter,
  actor: StaffActor,
  input: {
    action: ContentModerationAction;
    reason: string;
    subjectId: string;
    subjectType: ContentSubjectType;
  },
  policy: { requireCleanDocuments?: boolean } = {},
) {
  requireStaff(actor);
  const reason = decisionReason(input.reason);
  const transition = contentTransitions[input.action];
  return adapter.$transaction(async (tx) => {
    const requireCleanDocuments =
      policy.requireCleanDocuments ?? process.env.NODE_ENV === 'production';
    const cleanDocumentInvariant =
      requireCleanDocuments &&
      (input.action === 'APPROVE' || input.action === 'RESTORE') &&
      input.subjectType === 'RESOURCE'
        ? {
            assets: {
              none: {
                kind: 'RESOURCE_DOCUMENT',
                scanStatus: { not: 'CLEAN' },
              },
            },
          }
        : {};
    const changed = await contentDelegate(tx, input.subjectType).updateMany({
      data: { status: transition.to },
      where: {
        ...cleanDocumentInvariant,
        ...(input.subjectType === 'FORUM_COMMENT'
          ? { post: { campusId: actor.campusId } }
          : { campusId: actor.campusId }),
        id: input.subjectId,
        status: Array.isArray(transition.from)
          ? { in: transition.from }
          : transition.from,
      },
    });
    if (changed.count !== 1) throw new ModerationConflictError();
    const action = await tx.moderationAction.create({
      data: {
        action: input.action,
        actorId: actor.id,
        reason,
        subjectId: input.subjectId,
        subjectType: input.subjectType,
      },
    });
    await tx.auditLog.create({
      data: {
        action: transition.event,
        actorId: actor.id,
        campusId: actor.campusId,
        details: { from: transition.from, reason, to: transition.to },
        subjectId: input.subjectId,
        subjectType: input.subjectType,
      },
    });
    return { actionId: action.id, id: input.subjectId, status: transition.to };
  });
}

const sharedPendingSelect = {
  createdAt: true,
  id: true,
  status: true,
  title: true,
  updatedAt: true,
};

export async function listModerationContent(
  adapter: ModerationAdapter,
  actor: StaffActor,
  query: {
    pageSize?: number;
    providerStatus?: 'SKIPPED';
    status?: ModerationContentStatus;
  } = {},
): Promise<
  Array<Record<string, unknown> & { subjectType: ContentSubjectType }>
> {
  requireStaff(actor);
  const take = Math.max(1, Math.min(query.pageSize ?? 100, 200));
  const status = query.status ?? 'PENDING';
  const where = { campusId: actor.campusId, status };
  const orderBy = [{ createdAt: 'asc' }, { id: 'asc' }];
  const [resources, marketplace, jobs, forumPosts, forumComments] =
    await Promise.all([
      adapter.resource.findMany({
        orderBy,
        select: {
          ...sharedPendingSelect,
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
          summary: true,
        },
        take,
        where,
      }),
      adapter.marketplaceItem.findMany({
        orderBy,
        select: {
          ...sharedPendingSelect,
          assets: {
            select: {
              contentType: true,
              id: true,
              kind: true,
              sizeBytes: true,
            },
            where: { status: 'READY' },
          },
          condition: true,
          description: true,
          pickupArea: true,
          priceCents: true,
          seller: { select: { id: true, name: true } },
        },
        take,
        where,
      }),
      adapter.campusWorkPost.findMany({
        orderBy,
        select: {
          ...sharedPendingSelect,
          author: { select: { id: true, name: true } },
          description: true,
          location: true,
          payText: true,
        },
        take,
        where,
      }),
      adapter.forumPost.findMany({
        orderBy,
        select: {
          ...sharedPendingSelect,
          author: { select: { id: true, name: true } },
          body: true,
          category: true,
          kind: true,
          publicCode: true,
        },
        take,
        where,
      }),
      adapter.forumComment.findMany({
        orderBy,
        select: {
          author: { select: { id: true, name: true } },
          body: true,
          createdAt: true,
          id: true,
          post: { select: { id: true, title: true } },
          status: true,
          updatedAt: true,
        },
        take,
        where: {
          post: { campusId: actor.campusId },
          status,
        },
      }),
    ]);
  const typed: Array<
    Record<string, unknown> & { subjectType: ContentSubjectType }
  > = [
    ...resources.map((item) => ({ ...item, subjectType: 'RESOURCE' as const })),
    ...marketplace.map((item) => ({
      ...item,
      subjectType: 'MARKETPLACE_ITEM' as const,
    })),
    ...jobs.map((item) => ({ ...item, subjectType: 'JOB_POST' as const })),
    ...forumPosts.map((item) => ({
      ...item,
      subjectType: 'FORUM_POST' as const,
    })),
    ...forumComments.map((item) => ({
      ...item,
      subjectType: 'FORUM_COMMENT' as const,
    })),
  ];
  const targetType = (subjectType: ContentSubjectType) =>
    subjectType === 'JOB_POST' ? 'CAMPUS_WORK' : subjectType;
  const targetIds = typed.map((item) => String(item.id));
  const targetTypes = [
    ...new Set(typed.map((item) => targetType(item.subjectType))),
  ];
  const assessments = typed.length
    ? await adapter.contentAssessment.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          adminSignals: true,
          categories: true,
          createdAt: true,
          decision: true,
          id: true,
          model: true,
          providerStatus: true,
          reasonZh: true,
          riskScore: true,
          suggestionZh: true,
          targetId: true,
          targetType: true,
        },
        where: {
          campusId: actor.campusId,
          OR: [
            {
              targetId: { in: targetIds },
              targetType: { in: targetTypes },
            },
            ...targetIds.map((targetId) => ({
              targetId: { startsWith: `${targetId}:tag:` },
              targetType: 'CUSTOM_TAG',
            })),
          ],
        },
      })
    : [];
  const latestAssessment = new Map<string, Record<string, unknown>>();
  for (const assessment of assessments) {
    const key = `${String(assessment.targetType)}:${String(assessment.targetId)}`;
    if (!latestAssessment.has(key)) latestAssessment.set(key, assessment);
  }
  const assessmentRank = (assessment: Record<string, unknown>) => {
    if (assessment.decision === 'BLOCK') return 4;
    if (assessment.decision === 'REVIEW') return 3;
    if (assessment.providerStatus === 'SKIPPED') return 2;
    return 1;
  };
  return typed
    .map(
      (
        item,
      ): Record<string, unknown> & {
        assessment: Record<string, unknown> | null;
        subjectType: ContentSubjectType;
      } => {
        const mainAssessment = latestAssessment.get(
          `${targetType(item.subjectType)}:${String(item.id)}`,
        );
        const customTagPrefix = `${String(item.id)}:tag:`;
        const mainCreatedAt = mainAssessment?.createdAt;
        const candidates = [
          mainAssessment,
          ...Array.from(latestAssessment.values()).filter(
            (assessment) =>
              assessment.targetType === 'CUSTOM_TAG' &&
              String(assessment.targetId).startsWith(customTagPrefix) &&
              (!mainCreatedAt ||
                new Date(String(assessment.createdAt)).getTime() >=
                  new Date(String(mainCreatedAt)).getTime()),
          ),
        ].filter(
          (assessment): assessment is Record<string, unknown> =>
            assessment !== undefined,
        );
        const hasSkippedAssessment = candidates.some(
          (assessment) => assessment.providerStatus === 'SKIPPED',
        );
        const assessment = candidates.reduce<Record<string, unknown> | null>(
          (selected, candidate) =>
            !selected || assessmentRank(candidate) > assessmentRank(selected)
              ? candidate
              : selected,
          null,
        );
        if (!assessment) {
          return { ...item, assessment: null, hasSkippedAssessment };
        }
        if (actor.role === 'ADMIN') {
          return { ...item, assessment, hasSkippedAssessment };
        }
        const safeAssessment = { ...assessment };
        delete safeAssessment.adminSignals;
        return { ...item, assessment: safeAssessment, hasSkippedAssessment };
      },
    )
    .filter((item) => {
      if (!query.providerStatus) return true;
      return item.hasSkippedAssessment;
    })
    .sort((left, right) => {
      const byDate =
        new Date(String(left.createdAt)).getTime() -
        new Date(String(right.createdAt)).getTime();
      return byDate || String(left.id).localeCompare(String(right.id));
    })
    .slice(0, take);
}

export function listPendingContent(
  adapter: ModerationAdapter,
  actor: StaffActor,
  query: { pageSize?: number } = {},
) {
  return listModerationContent(adapter, actor, {
    ...query,
    status: 'PENDING',
  });
}

export function toModerationQueueDto(
  items: Array<Record<string, unknown> & { subjectType: ContentSubjectType }>,
) {
  return items.map((item) => ({
    ...item,
    assets: Array.isArray(item.assets)
      ? item.assets.map((asset) => {
          const record = asset as Record<string, unknown>;
          return {
            ...record,
            sizeBytes:
              typeof record.sizeBytes === 'bigint'
                ? record.sizeBytes.toString(10)
                : String(record.sizeBytes),
          };
        })
      : [],
  }));
}

const severity = {
  PROHIBITED: 0,
  HARASSMENT: 1,
  MISLEADING: 2,
  SPAM: 3,
  OTHER: 4,
} as const;

export async function listModerationReports(
  adapter: ModerationAdapter,
  actor: StaffActor,
  query: { pageSize?: number } = {},
) {
  requireStaff(actor);
  const take = Math.max(1, Math.min(query.pageSize ?? 100, 200));
  const reports = await adapter.report.findMany({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      assignee: { select: { id: true, name: true } },
      createdAt: true,
      details: true,
      id: true,
      reason: true,
      reporter: { select: { id: true, name: true } },
      status: true,
      targetId: true,
      targetType: true,
      updatedAt: true,
    },
    take,
    where: {
      campusId: actor.campusId,
      status: { in: ['OPEN', 'TRIAGED'] },
    },
  });
  const subjectIds = [
    ...reports.map((report) => String(report.id)),
    ...reports.map((report) => String(report.targetId)),
  ];
  const history =
    subjectIds.length === 0
      ? []
      : await adapter.moderationAction.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            action: true,
            actor: { select: { id: true, name: true } },
            actorId: true,
            createdAt: true,
            id: true,
            reason: true,
            subjectId: true,
            subjectType: true,
          },
          where: {
            subjectId: { in: subjectIds },
            subjectType: {
              in: ['REPORT', 'RESOURCE', 'MARKETPLACE_ITEM', 'JOB_POST'],
            },
          },
        });
  const enriched: Array<
    Record<string, unknown> & { history: Record<string, unknown>[] }
  > = reports.map((report) => ({
    ...report,
    history: history.filter(
      (entry) =>
        String(entry.subjectId) === String(report.id) ||
        String(entry.subjectId) === String(report.targetId),
    ),
  }));
  return enriched.sort((left, right) => {
    const leftSeverity =
      severity[String(left.reason) as keyof typeof severity] ?? 9;
    const rightSeverity =
      severity[String(right.reason) as keyof typeof severity] ?? 9;
    return (
      leftSeverity - rightSeverity ||
      new Date(String(left.createdAt)).getTime() -
        new Date(String(right.createdAt)).getTime() ||
      String(left.id).localeCompare(String(right.id))
    );
  });
}

async function changeReportStatus(
  adapter: ModerationAdapter,
  actor: StaffActor,
  input: { action: 'TRIAGE' | 'DISMISS'; reason: string; reportId: string },
) {
  requireStaff(actor);
  const reason = decisionReason(input.reason);
  const status = input.action === 'TRIAGE' ? 'TRIAGED' : 'DISMISSED';
  const currentStatus = input.action === 'TRIAGE' ? 'OPEN' : 'TRIAGED';
  return adapter.$transaction(async (tx) => {
    const changed = await tx.report.updateMany({
      data: { assigneeId: actor.id, status },
      where: {
        campusId: actor.campusId,
        id: input.reportId,
        status: currentStatus,
      },
    });
    if (changed.count !== 1) throw new ModerationConflictError();
    await tx.moderationAction.create({
      data: {
        action: input.action,
        actorId: actor.id,
        reason,
        subjectId: input.reportId,
        subjectType: 'REPORT',
      },
    });
    await tx.auditLog.create({
      data: {
        action: `REPORT_${status}`,
        actorId: actor.id,
        campusId: actor.campusId,
        details: { reason, status },
        subjectId: input.reportId,
        subjectType: 'REPORT',
      },
    });
    return { id: input.reportId, status };
  });
}

export function triageReport(
  adapter: ModerationAdapter,
  actor: StaffActor,
  input: { reason: string; reportId: string },
) {
  return changeReportStatus(adapter, actor, { ...input, action: 'TRIAGE' });
}

export function dismissReport(
  adapter: ModerationAdapter,
  actor: StaffActor,
  input: { reason: string; reportId: string },
) {
  return changeReportStatus(adapter, actor, { ...input, action: 'DISMISS' });
}

type RetainedReportTarget = {
  assets: unknown;
  kind: 'resource' | 'marketplace' | 'campus-work' | 'forum';
  targetId: string;
};

async function findRetainedReportTarget(
  adapter: ModerationAdapter,
  campusId: string,
  targetId: string,
  targetType: unknown,
): Promise<RetainedReportTarget | null> {
  if (targetType === 'FORUM_COMMENT') {
    const comment = await adapter.forumComment.findFirst({
      select: {
        id: true,
        post: {
          select: {
            campusId: true,
            id: true,
            ownerDeletionRequestedAt: true,
          },
        },
      },
      where: { id: targetId, post: { campusId } },
    });
    const post = comment?.post as Record<string, unknown> | undefined;
    if (!comment || comment.id !== targetId || !post) return null;
    if (post.campusId !== campusId || typeof post.id !== 'string') {
      throw new ModerationConflictError();
    }
    if (post.ownerDeletionRequestedAt == null) return null;
    return { assets: [], kind: 'forum', targetId: post.id };
  }
  const kind =
    targetType === 'RESOURCE'
      ? 'resource'
      : targetType === 'MARKETPLACE_ITEM'
        ? 'marketplace'
        : targetType === 'JOB_POST'
          ? 'campus-work'
          : targetType === 'FORUM_POST'
            ? 'forum'
            : null;
  if (!kind) return null;
  const delegate = contentDelegate(adapter, targetType as ContentSubjectType);
  const target = await delegate.findFirst({
    select: {
      ...(kind === 'resource' || kind === 'marketplace'
        ? {
            assets: {
              select: { id: true, status: true, storageKey: true },
            },
          }
        : {}),
      campusId: true,
      id: true,
      ownerDeletionRequestedAt: true,
    },
    where: { campusId, id: targetId },
  });
  if (!target || target.ownerDeletionRequestedAt == null) return null;
  if (target.id !== targetId || target.campusId !== campusId) {
    throw new ModerationConflictError();
  }
  return { assets: target.assets, kind, targetId };
}

async function purgeRetainedReportTarget(
  transaction: ModerationAdapter,
  campusId: string,
  reportId: string,
  reportTargetType: string,
  target: RetainedReportTarget,
) {
  if (target.kind === 'forum') {
    const activeEvidence = await transaction.$queryRawUnsafe<
      Array<{ id: string }>
    >(
      `SELECT report.id
       FROM "Report" AS report
       LEFT JOIN "ForumComment" AS comment
         ON report."targetType" = 'FORUM_COMMENT'
        AND comment.id = report."targetId"
       WHERE report."campusId" = $1
         AND report.id <> $3
         AND report.status IN ('OPEN', 'TRIAGED')
         AND (
           (report."targetType" = 'FORUM_POST' AND report."targetId" = $2)
           OR
           (report."targetType" = 'FORUM_COMMENT' AND comment."postId" = $2)
         )
       ORDER BY report.id
       LIMIT 1`,
      campusId,
      target.targetId,
      reportId,
    );
    if (activeEvidence.length > 0) return false;
    const removed = await transaction.forumPost.deleteMany({
      where: {
        campusId,
        id: target.targetId,
        ownerDeletionRequestedAt: { not: null },
      },
    });
    if (removed.count !== 1) throw new ModerationConflictError();
    return true;
  }
  const anotherActiveReport = await transaction.report.findFirst({
    select: { id: true },
    where: {
      campusId,
      id: { not: reportId },
      status: { in: ['OPEN', 'TRIAGED'] },
      targetId: target.targetId,
      targetType: reportTargetType,
    },
  });
  if (anotherActiveReport) return false;
  await purgeContentRecord(
    transaction as unknown as ContentAdapter,
    target.kind,
    {
      assets: target.assets,
      campusId,
      id: target.targetId,
      where: {
        campusId,
        id: target.targetId,
        ownerDeletionRequestedAt: { not: null },
      },
    },
  );
  return true;
}

export async function resolveReport(
  adapter: ModerationAdapter,
  actor: StaffActor,
  input: { hideTarget: boolean; reason: string; reportId: string },
) {
  requireStaff(actor);
  const reason = decisionReason(input.reason);
  return adapter.$transaction(async (tx) => {
    const report = await tx.report.findFirst({
      select: { id: true, status: true, targetId: true, targetType: true },
      where: {
        campusId: actor.campusId,
        id: input.reportId,
        status: 'TRIAGED',
      },
    });
    if (!report) throw new ModerationConflictError();
    const changed = await tx.report.updateMany({
      data: { assigneeId: actor.id, status: 'RESOLVED' },
      where: {
        campusId: actor.campusId,
        id: input.reportId,
        status: 'TRIAGED',
      },
    });
    if (changed.count !== 1) throw new ModerationConflictError();

    const retainedTarget = await findRetainedReportTarget(
      tx,
      actor.campusId,
      String(report.targetId),
      report.targetType,
    );
    const purgedTarget = retainedTarget
      ? await purgeRetainedReportTarget(
          tx,
          actor.campusId,
          input.reportId,
          String(report.targetType),
          retainedTarget,
        )
      : false;
    const hiddenTarget = input.hideTarget && !retainedTarget;

    if (hiddenTarget) {
      if (
        report.targetType !== 'RESOURCE' &&
        report.targetType !== 'MARKETPLACE_ITEM' &&
        report.targetType !== 'JOB_POST'
      ) {
        throw new ModerationValidationError(
          'This report target cannot be hidden',
        );
      }
      const hidden = await contentDelegate(
        tx,
        report.targetType as ContentSubjectType,
      ).updateMany({
        data: { status: 'HIDDEN' },
        where: {
          campusId: actor.campusId,
          id: report.targetId,
          status: 'PUBLISHED',
        },
      });
      if (hidden.count !== 1) throw new ModerationConflictError();
    }

    await tx.moderationAction.create({
      data: {
        action: 'RESOLVE',
        actorId: actor.id,
        reason,
        subjectId: input.reportId,
        subjectType: 'REPORT',
      },
    });
    await tx.auditLog.create({
      data: {
        action: 'REPORT_RESOLVED',
        actorId: actor.id,
        campusId: actor.campusId,
        details: { hiddenTarget, purgedTarget, reason },
        subjectId: input.reportId,
        subjectType: 'REPORT',
      },
    });
    if (hiddenTarget) {
      await tx.moderationAction.create({
        data: {
          action: 'HIDE',
          actorId: actor.id,
          reason,
          subjectId: String(report.targetId),
          subjectType: String(report.targetType),
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'CONTENT_HIDDEN_FROM_REPORT',
          actorId: actor.id,
          campusId: actor.campusId,
          details: { reason, reportId: input.reportId },
          subjectId: String(report.targetId),
          subjectType: String(report.targetType),
        },
      });
    }
    return {
      hiddenTarget,
      id: input.reportId,
      purgedTarget,
      status: 'RESOLVED',
    };
  });
}
