import {
  fingerprintAnonymousUser,
  type AnonymousIdentityKeyring,
} from '@/lib/security/anonymous-identity';

export type ReportTargetType =
  'RESOURCE' | 'MARKETPLACE_ITEM' | 'JOB_POST' | 'FORUM_POST' | 'FORUM_COMMENT';
export type ReportReason =
  'SPAM' | 'MISLEADING' | 'HARASSMENT' | 'PROHIBITED' | 'OTHER';

export interface ReportReaderActor {
  campusId: string;
  id: string;
}

export interface ReportActor extends ReportReaderActor {
  emailVerifiedAt: Date | null;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'BANNED';
}

export interface CreateReportInput {
  details?: string;
  reason: ReportReason;
  targetId: string;
  targetType: ReportTargetType;
}

type AnonymousIdentityKeySource =
  AnonymousIdentityKeyring | (() => AnonymousIdentityKeyring);

interface TargetDelegate {
  findFirst(
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
}

export interface ReportsAdapter {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $transaction<T>(
    operation: (tx: ReportsAdapter) => Promise<T>,
    options?: { isolationLevel: 'Serializable' },
  ): Promise<T>;
  forumComment: TargetDelegate;
  forumPost: TargetDelegate;
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

export class ReportVerificationRequiredError extends Error {
  constructor() {
    super('A verified active account is required');
  }
}

async function lockReportedPost(
  adapter: ReportsAdapter,
  actor: ReportActor,
  postId: string,
) {
  const rows = await adapter.$queryRawUnsafe<
    Array<{ campusId: string; id: string }>
  >(
    `SELECT id, "campusId"
     FROM "ForumPost"
     WHERE id = $1 AND "campusId" = $2
     FOR KEY SHARE`,
    postId,
    actor.campusId,
  );
  if (
    rows.length !== 1 ||
    rows[0]?.id !== postId ||
    rows[0]?.campusId !== actor.campusId
  ) {
    throw new ReportNotFoundError();
  }
}

async function lockReportedComment(
  adapter: ReportsAdapter,
  commentId: string,
  postId: string,
) {
  const rows = await adapter.$queryRawUnsafe<
    Array<{ id: string; postId: string }>
  >(
    `SELECT id, "postId"
     FROM "ForumComment"
     WHERE id = $1 AND "postId" = $2
     FOR KEY SHARE`,
    commentId,
    postId,
  );
  if (
    rows.length !== 1 ||
    rows[0]?.id !== commentId ||
    rows[0]?.postId !== postId
  ) {
    throw new ReportNotFoundError();
  }
}

function targetPolicy(targetType: ReportTargetType) {
  if (targetType === 'MARKETPLACE_ITEM') {
    return { delegate: 'marketplaceItem' as const, ownerField: 'sellerId' };
  }
  if (targetType === 'FORUM_POST' || targetType === 'FORUM_COMMENT') {
    throw new ReportNotFoundError();
  }
  return {
    delegate:
      targetType === 'RESOURCE' ? ('resource' as const) : ('jobPost' as const),
    ownerField: 'authorId',
  };
}

function requireVerifiedReportActor(actor: ReportActor) {
  if (actor.status !== 'ACTIVE' || !(actor.emailVerifiedAt instanceof Date)) {
    throw new ReportVerificationRequiredError();
  }
}

async function validateForumTarget(
  tx: ReportsAdapter,
  actor: ReportActor,
  input: CreateReportInput,
  keySource?: AnonymousIdentityKeySource,
) {
  if (input.targetType === 'FORUM_POST') {
    await lockReportedPost(tx, actor, input.targetId);
    const post = await tx.forumPost.findFirst({
      select: {
        campusId: true,
        id: true,
        kind: true,
        status: true,
      },
      where: {
        campusId: actor.campusId,
        id: input.targetId,
        status: 'PUBLISHED',
      },
    });
    if (
      !post ||
      post.campusId !== actor.campusId ||
      post.id !== input.targetId ||
      post.status !== 'PUBLISHED' ||
      (post.kind !== 'DISCUSSION' && post.kind !== 'TREE_HOLE')
    ) {
      throw new ReportNotFoundError();
    }
    if (post.kind === 'DISCUSSION') {
      const ownership = await tx.forumPost.findFirst({
        select: {
          authorId: true,
          campusId: true,
          id: true,
          kind: true,
          status: true,
        },
        where: {
          campusId: actor.campusId,
          id: input.targetId,
          kind: 'DISCUSSION',
          status: 'PUBLISHED',
        },
      });
      if (
        !ownership ||
        ownership.campusId !== actor.campusId ||
        ownership.id !== input.targetId ||
        ownership.kind !== 'DISCUSSION' ||
        ownership.status !== 'PUBLISHED' ||
        typeof ownership.authorId !== 'string'
      ) {
        throw new ReportNotFoundError();
      }
      if (ownership.authorId === actor.id) throw new ReportOwnContentError();
      return;
    }
    const ownership = await tx.forumPost.findFirst({
      select: {
        anonymousFingerprint: true,
        campusId: true,
        id: true,
        kind: true,
        status: true,
      },
      where: {
        campusId: actor.campusId,
        id: input.targetId,
        kind: 'TREE_HOLE',
        status: 'PUBLISHED',
      },
    });
    const keys = typeof keySource === 'function' ? keySource() : keySource;
    if (
      !ownership ||
      ownership.campusId !== actor.campusId ||
      ownership.id !== input.targetId ||
      ownership.kind !== 'TREE_HOLE' ||
      ownership.status !== 'PUBLISHED' ||
      typeof ownership.anonymousFingerprint !== 'string' ||
      ownership.anonymousFingerprint.length !== 64 ||
      !keys
    ) {
      throw new ReportNotFoundError();
    }
    if (
      ownership.anonymousFingerprint ===
      fingerprintAnonymousUser(actor.id, keys)
    ) {
      throw new ReportOwnContentError();
    }
    return;
  }

  const discovered = await tx.forumComment.findFirst({
    select: { postId: true },
    where: { id: input.targetId },
  });
  if (!discovered || typeof discovered.postId !== 'string') {
    throw new ReportNotFoundError();
  }
  await lockReportedPost(tx, actor, discovered.postId);
  await lockReportedComment(tx, input.targetId, discovered.postId);

  const comment = await tx.forumComment.findFirst({
    select: {
      authorId: true,
      id: true,
      post: {
        select: { campusId: true, id: true, kind: true, status: true },
      },
      postId: true,
      status: true,
    },
    where: {
      id: input.targetId,
      post: {
        campusId: actor.campusId,
        kind: 'DISCUSSION',
        status: 'PUBLISHED',
      },
      status: 'PUBLISHED',
    },
  });
  const post = comment?.post as Record<string, unknown> | undefined;
  if (
    !comment ||
    comment.id !== input.targetId ||
    comment.status !== 'PUBLISHED' ||
    typeof comment.postId !== 'string' ||
    !post ||
    post.id !== comment.postId ||
    post.campusId !== actor.campusId ||
    post.kind !== 'DISCUSSION' ||
    post.status !== 'PUBLISHED' ||
    typeof comment.authorId !== 'string'
  ) {
    throw new ReportNotFoundError();
  }
  if (comment.authorId === actor.id) throw new ReportOwnContentError();
}

function isUniqueConflict(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const code = String((error as { code?: unknown }).code ?? '');
  return code === 'P2002' || code === '23505';
}

function isSerializationFailure(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; meta?: { code?: unknown } };
  return (
    candidate.code === 'P2034' ||
    candidate.code === '40001' ||
    candidate.meta?.code === '40001'
  );
}

async function serializableReportTransaction<T>(
  adapter: ReportsAdapter,
  operation: (tx: ReportsAdapter) => Promise<T>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await adapter.$transaction(operation, {
        isolationLevel: 'Serializable',
      });
    } catch (error) {
      if (isSerializationFailure(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error('Unreachable report transaction state.');
}

export async function createReport(
  adapter: ReportsAdapter,
  actor: ReportActor,
  input: CreateReportInput,
  keySource?: AnonymousIdentityKeySource,
) {
  requireVerifiedReportActor(actor);
  try {
    return await serializableReportTransaction(adapter, async (tx) => {
      if (
        input.targetType === 'FORUM_POST' ||
        input.targetType === 'FORUM_COMMENT'
      ) {
        await validateForumTarget(tx, actor, input, keySource);
      } else {
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
      }
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
  actor: ReportReaderActor,
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
