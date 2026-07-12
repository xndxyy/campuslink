export type ReportTargetType = 'RESOURCE' | 'MARKETPLACE_ITEM' | 'JOB_POST';
export type ReportReason =
  'SPAM' | 'MISLEADING' | 'HARASSMENT' | 'PROHIBITED' | 'OTHER';

export interface ReportActor {
  campusId: string;
  id: string;
}

export interface CreateReportInput {
  details?: string;
  reason: ReportReason;
  targetId: string;
  targetType: ReportTargetType;
}

interface TargetDelegate {
  findFirst(
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
}

export interface ReportsAdapter {
  $transaction<T>(operation: (tx: ReportsAdapter) => Promise<T>): Promise<T>;
  jobPost: TargetDelegate;
  marketplaceItem: TargetDelegate;
  report: {
    create(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
  resource: TargetDelegate;
}

export class ReportNotFoundError extends Error {
  constructor() {
    super('Published content was not found');
  }
}

export class ReportOwnContentError extends Error {
  constructor() {
    super('Cannot report own content');
  }
}

export class ReportDuplicateError extends Error {
  constructor() {
    super('An open report already exists');
  }
}

function targetPolicy(targetType: ReportTargetType) {
  if (targetType === 'MARKETPLACE_ITEM') {
    return { delegate: 'marketplaceItem' as const, ownerField: 'sellerId' };
  }
  return {
    delegate:
      targetType === 'RESOURCE' ? ('resource' as const) : ('jobPost' as const),
    ownerField: 'authorId',
  };
}

function isUniqueConflict(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const code = String((error as { code?: unknown }).code ?? '');
  return code === 'P2002' || code === '23505';
}

export async function createReport(
  adapter: ReportsAdapter,
  actor: ReportActor,
  input: CreateReportInput,
) {
  try {
    return await adapter.$transaction(async (tx) => {
      const policy = targetPolicy(input.targetType);
      const target = await tx[policy.delegate].findFirst({
        select: { [policy.ownerField]: true },
        where: {
          campusId: actor.campusId,
          id: input.targetId,
          status: 'PUBLISHED',
        },
      });
      if (!target) throw new ReportNotFoundError();
      if (target[policy.ownerField] === actor.id)
        throw new ReportOwnContentError();
      return tx.report.create({
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
    });
  } catch (error) {
    if (
      error instanceof ReportNotFoundError ||
      error instanceof ReportOwnContentError
    ) {
      throw error;
    }
    if (isUniqueConflict(error)) throw new ReportDuplicateError();
    throw error;
  }
}

const neutralOutcome = {
  DISMISSED: 'The review is complete.',
  OPEN: 'Your report was received.',
  RESOLVED: 'The review is complete.',
  TRIAGED: 'Your report is under review.',
} as const;

export async function listReporterReports(
  adapter: ReportsAdapter,
  actor: ReportActor,
  query: { page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, Math.min(query.page ?? 1, 50));
  const pageSize = Math.max(1, Math.min(query.pageSize ?? 12, 50));
  const records = await adapter.report.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      createdAt: true,
      id: true,
      status: true,
      targetId: true,
      targetType: true,
      updatedAt: true,
    },
    skip: (page - 1) * pageSize,
    take: pageSize,
    where: {
      campusId: actor.campusId,
      reporterId: actor.id,
      status: { in: ['OPEN', 'TRIAGED', 'RESOLVED', 'DISMISSED'] },
    },
  });
  return {
    items: records.map((record) => ({
      ...record,
      outcome: neutralOutcome[record.status as keyof typeof neutralOutcome],
    })),
    page,
    pageSize,
  };
}
