import {
  AnonymousIdentityError,
  openAnonymousIdentity,
  parseSerializedAnonymousIdentityEnvelope,
  type AnonymousIdentityKeyring,
} from '@/lib/security/anonymous-identity';
import { isTransactionConflict } from '@/lib/domain/transaction-errors';
import { sanitizeAuditDetails } from './audit-details';

type StaffRole = 'STUDENT' | 'MODERATOR' | 'ADMIN';

export interface TreeHoleIdentityActor {
  campusId: string;
  id: string;
  role: StaffRole;
}

export interface TreeHoleIdentityInput {
  postId: string;
  reason: string;
  reportId: string;
}

interface FindFirstDelegate {
  findFirst(
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
}

export interface TreeHoleIdentityAdapter {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $transaction<T>(
    operation: (tx: TreeHoleIdentityAdapter) => Promise<T>,
    options?: { isolationLevel: 'Serializable' },
  ): Promise<T>;
  auditLog: {
    create(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  forumPost: FindFirstDelegate;
  report: FindFirstDelegate;
}

export class TreeHoleIdentityForbiddenError extends Error {
  constructor() {
    super('Tree-hole identity access is forbidden');
    this.name = 'TreeHoleIdentityForbiddenError';
  }
}

export class TreeHoleIdentityValidationError extends Error {
  constructor() {
    super('Tree-hole identity request is invalid');
    this.name = 'TreeHoleIdentityValidationError';
  }
}

function boundedId(value: unknown) {
  if (typeof value !== 'string') throw new TreeHoleIdentityValidationError();
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 191) {
    throw new TreeHoleIdentityValidationError();
  }
  return trimmed;
}

function boundedReason(value: unknown) {
  if (typeof value !== 'string') throw new TreeHoleIdentityValidationError();
  const trimmed = value.trim();
  if (trimmed.length < 5 || trimmed.length > 1000) {
    throw new TreeHoleIdentityValidationError();
  }
  return trimmed;
}

async function serializableTransaction<T>(
  adapter: TreeHoleIdentityAdapter,
  operation: (tx: TreeHoleIdentityAdapter) => Promise<T>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await adapter.$transaction(operation, {
        isolationLevel: 'Serializable',
      });
    } catch (error) {
      if (!isTransactionConflict(error) || attempt === 2) throw error;
    }
  }
  throw new Error('Unreachable tree-hole identity transaction state.');
}

function activeMatchingReport(
  report: Record<string, unknown> | null,
  actor: TreeHoleIdentityActor,
  input: { postId: string; reportId: string },
) {
  return (
    report?.id === input.reportId &&
    report.campusId === actor.campusId &&
    report.targetType === 'FORUM_POST' &&
    report.targetId === input.postId &&
    (report.status === 'OPEN' || report.status === 'TRIAGED')
  );
}

function matchingTreeHole(
  post: Record<string, unknown> | null,
  actor: TreeHoleIdentityActor,
  postId: string,
) {
  return (
    post?.id === postId &&
    post.campusId === actor.campusId &&
    post.kind === 'TREE_HOLE'
  );
}

function storedEnvelope(post: Record<string, unknown>) {
  if (
    typeof post.anonymousCiphertext !== 'string' ||
    typeof post.anonymousKeyVersion !== 'number'
  ) {
    throw new AnonymousIdentityError(
      'MALFORMED_ENVELOPE',
      'Stored anonymous identity envelope is invalid.',
    );
  }

  const envelope = parseSerializedAnonymousIdentityEnvelope(
    post.anonymousCiphertext,
  );
  if (envelope.keyVersion !== post.anonymousKeyVersion) {
    throw new AnonymousIdentityError(
      'MALFORMED_ENVELOPE',
      'Stored anonymous identity key version is inconsistent.',
    );
  }
  return envelope;
}

export async function revealTreeHoleAuthor(
  adapter: TreeHoleIdentityAdapter,
  actor: TreeHoleIdentityActor,
  rawInput: TreeHoleIdentityInput,
  keys: AnonymousIdentityKeyring,
) {
  if (actor.role !== 'ADMIN') throw new TreeHoleIdentityForbiddenError();
  const input = {
    postId: boundedId(rawInput.postId),
    reason: boundedReason(rawInput.reason),
    reportId: boundedId(rawInput.reportId),
  };

  return serializableTransaction(adapter, async (tx) => {
    const lockedReports = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id
       FROM "Report"
       WHERE id = $1 AND "campusId" = $2
       FOR UPDATE`,
      input.reportId,
      actor.campusId,
    );
    if (lockedReports.length !== 1 || lockedReports[0]?.id !== input.reportId) {
      throw new TreeHoleIdentityForbiddenError();
    }

    const report = await tx.report.findFirst({
      select: {
        campusId: true,
        id: true,
        status: true,
        targetId: true,
        targetType: true,
      },
      where: {
        campusId: actor.campusId,
        id: input.reportId,
        status: { in: ['OPEN', 'TRIAGED'] },
        targetId: input.postId,
        targetType: 'FORUM_POST',
      },
    });
    if (!activeMatchingReport(report, actor, input)) {
      throw new TreeHoleIdentityForbiddenError();
    }

    const post = await tx.forumPost.findFirst({
      select: {
        anonymousCiphertext: true,
        anonymousKeyVersion: true,
        campusId: true,
        id: true,
        kind: true,
      },
      where: {
        campusId: actor.campusId,
        id: input.postId,
        kind: 'TREE_HOLE',
      },
    });
    if (!post || !matchingTreeHole(post, actor, input.postId)) {
      throw new TreeHoleIdentityForbiddenError();
    }

    const userId = openAnonymousIdentity(storedEnvelope(post), keys);
    const details = sanitizeAuditDetails({
      postId: input.postId,
      reason: input.reason,
      reportId: input.reportId,
    });
    await tx.auditLog.create({
      data: {
        action: 'TREE_HOLE_AUTHOR_REVEALED',
        actorId: actor.id,
        campusId: actor.campusId,
        details,
        subjectId: input.reportId,
        subjectType: 'REPORT',
      },
      select: { id: true },
    });
    return { userId };
  });
}
