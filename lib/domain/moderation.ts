export type StaffRole = 'STUDENT' | 'MODERATOR' | 'ADMIN';
export type ContentSubjectType = 'RESOURCE' | 'MARKETPLACE_ITEM' | 'JOB_POST';
export type ContentModerationAction =
  'APPROVE' | 'REJECT' | 'HIDE' | 'RESTORE' | 'ARCHIVE';

export interface StaffActor {
  campusId: string;
  id: string;
  role: StaffRole;
}

interface ContentDelegate {
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
  $transaction<T>(operation: (tx: ModerationAdapter) => Promise<T>): Promise<T>;
  auditLog: CreateDelegate;
  jobPost: ContentDelegate;
  marketplaceItem: ContentDelegate;
  moderationAction: CreateDelegate;
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
  return adapter.jobPost;
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
) {
  requireStaff(actor);
  const reason = decisionReason(input.reason);
  const transition = contentTransitions[input.action];
  return adapter.$transaction(async (tx) => {
    const changed = await contentDelegate(tx, input.subjectType).updateMany({
      data: { status: transition.to },
      where: {
        campusId: actor.campusId,
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

export async function listPendingContent(
  adapter: ModerationAdapter,
  actor: StaffActor,
  query: { pageSize?: number } = {},
): Promise<
  Array<Record<string, unknown> & { subjectType: ContentSubjectType }>
> {
  requireStaff(actor);
  const take = Math.max(1, Math.min(query.pageSize ?? 100, 200));
  const where = { campusId: actor.campusId, status: 'PENDING' };
  const orderBy = [{ createdAt: 'asc' }, { id: 'asc' }];
  const [resources, marketplace, jobs] = await Promise.all([
    adapter.resource.findMany({
      orderBy,
      select: {
        ...sharedPendingSelect,
        assets: {
          select: { contentType: true, id: true, kind: true, sizeBytes: true },
          where: { status: 'READY' },
        },
        author: { select: { id: true, name: true } },
        courseCode: true,
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
          select: { contentType: true, id: true, kind: true, sizeBytes: true },
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
    adapter.jobPost.findMany({
      orderBy,
      select: {
        ...sharedPendingSelect,
        author: { select: { id: true, name: true } },
        company: true,
        description: true,
        location: true,
        payText: true,
      },
      take,
      where,
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
  ];
  return typed
    .sort((left, right) => {
      const byDate =
        new Date(String(left.createdAt)).getTime() -
        new Date(String(right.createdAt)).getTime();
      return byDate || String(left.id).localeCompare(String(right.id));
    })
    .slice(0, take);
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
    where: { status: { in: ['OPEN', 'TRIAGED'] } },
  });
  return reports.sort((left, right) => {
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
  return adapter.$transaction(async (tx) => {
    const changed = await tx.report.updateMany({
      data: { assigneeId: actor.id, status },
      where: {
        id: input.reportId,
        status: {
          in:
            input.action === 'TRIAGE'
              ? ['OPEN', 'TRIAGED']
              : ['OPEN', 'TRIAGED'],
        },
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
      where: { id: input.reportId, status: { in: ['OPEN', 'TRIAGED'] } },
    });
    if (!report) throw new ModerationConflictError();
    const changed = await tx.report.updateMany({
      data: { assigneeId: actor.id, status: 'RESOLVED' },
      where: { id: input.reportId, status: { in: ['OPEN', 'TRIAGED'] } },
    });
    if (changed.count !== 1) throw new ModerationConflictError();

    if (input.hideTarget) {
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
        details: { hiddenTarget: input.hideTarget, reason },
        subjectId: input.reportId,
        subjectType: 'REPORT',
      },
    });
    if (input.hideTarget) {
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
          details: { reason, reportId: input.reportId },
          subjectId: String(report.targetId),
          subjectType: String(report.targetType),
        },
      });
    }
    return {
      hiddenTarget: input.hideTarget,
      id: input.reportId,
      status: 'RESOLVED',
    };
  });
}
