import { randomBytes, randomUUID } from 'node:crypto';

import { getDefaultCampusSlug } from '@/lib/config';
import {
  ContentBlockedError,
  persistPreparedAssessmentBatch,
  publishingOutcomeStatus,
  type PreparedAssessmentBatch,
  type PublishingAssessmentPolicy,
} from '@/lib/moderation/content-assessment';
import {
  fingerprintAnonymousUser,
  sealAnonymousIdentity,
  serializeAnonymousIdentityEnvelope,
  type AnonymousIdentityKeyring,
} from '@/lib/security/anonymous-identity';
import {
  createForumCommentSchema,
  createForumPostSchema,
  deleteForumCommentSchema,
  forumListQuerySchema,
  updateForumCommentSchema,
  updateForumPostSchema,
  type CreateForumPostInput,
  type ForumListQuery,
  type UpdateForumPostInput,
} from '@/lib/validation/forum';

type ForumPostKind = 'DISCUSSION' | 'TREE_HOLE';
type ForumView = 'discussion' | 'tree-hole';

export interface ForumActor {
  campusId: string;
  emailVerifiedAt: Date | null;
  id: string;
  role: 'STUDENT' | 'MODERATOR' | 'ADMIN';
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'BANNED';
}

interface RecordDelegate {
  count(args: Record<string, unknown>): Promise<number>;
  create(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  delete(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  findFirst(
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
  findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  update(args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

interface CommentDelegate {
  count(args: Record<string, unknown>): Promise<number>;
  create(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  delete(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  findFirst(
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
  findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  update(args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface ForumAdapter {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $transaction<T>(
    operation: (tx: ForumAdapter) => Promise<T>,
    options?: { isolationLevel: 'Serializable' },
  ): Promise<T>;
  campus: {
    findFirst(
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown> | null>;
  };
  auditLog: {
    create(args: Record<string, unknown>): Promise<unknown>;
  };
  contentAssessment: {
    create(args: Record<string, unknown>): Promise<{ id: string }>;
  };
  forumCategory: {
    findFirst(
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown> | null>;
  };
  forumComment: CommentDelegate;
  forumLike: {
    count(args: Record<string, unknown>): Promise<number>;
    create(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    deleteMany(args: Record<string, unknown>): Promise<{ count: number }>;
    findUnique(
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown> | null>;
  };
  forumPost: RecordDelegate;
  report: {
    findFirst(
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown> | null>;
  };
}

async function prepareForumPublishing(
  actor: ForumActor,
  policy: PublishingAssessmentPolicy | undefined,
  targetType: 'FORUM_POST' | 'FORUM_COMMENT',
  content: Readonly<Record<string, string>>,
  existingTargetId?: string,
) {
  if (!policy) return null;
  const targetId =
    existingTargetId ?? (policy.generateTargetId ?? randomUUID)();
  const prepared = await policy.prepare({
    campusId: actor.campusId,
    requests: [{ content, targetId, targetType }],
  });
  if (
    prepared.outcome.kind === 'block' &&
    prepared.outcome.source === 'local'
  ) {
    throw new ContentBlockedError(prepared.outcome);
  }
  return { prepared, targetId };
}

function throwForumProviderBlock(
  prepared: PreparedAssessmentBatch | undefined,
) {
  if (prepared?.outcome.kind === 'block') {
    throw new ContentBlockedError(prepared.outcome);
  }
}

export class ForumVerificationRequiredError extends Error {
  constructor() {
    super('A verified active account is required');
    this.name = 'ForumVerificationRequiredError';
  }
}

export class ForumForbiddenError extends Error {
  constructor() {
    super('Forum action is forbidden');
    this.name = 'ForumForbiddenError';
  }
}

export class ForumNotFoundError extends Error {
  constructor() {
    super('Forum content was not found');
    this.name = 'ForumNotFoundError';
  }
}

export class ForumConflictError extends Error {
  constructor() {
    super('Forum content state conflict');
    this.name = 'ForumConflictError';
  }
}

export class ForumValidationError extends Error {
  constructor() {
    super('Forum input is invalid');
    this.name = 'ForumValidationError';
  }
}

async function lockForumPost(
  adapter: ForumAdapter,
  campusId: string,
  postId: string,
  mode: 'key-share' | 'update',
) {
  const rows =
    mode === 'update'
      ? await adapter.$queryRawUnsafe<Array<{ campusId: string; id: string }>>(
          `SELECT id, "campusId"
           FROM "ForumPost"
           WHERE id = $1 AND "campusId" = $2
           FOR UPDATE`,
          postId,
          campusId,
        )
      : await adapter.$queryRawUnsafe<Array<{ campusId: string; id: string }>>(
          `SELECT id, "campusId"
           FROM "ForumPost"
           WHERE id = $1 AND "campusId" = $2
           FOR KEY SHARE`,
          postId,
          campusId,
        );
  if (
    rows.length !== 1 ||
    rows[0]?.id !== postId ||
    rows[0]?.campusId !== campusId
  ) {
    throw new ForumNotFoundError();
  }
}

async function lockForumCommentForUpdate(
  adapter: ForumAdapter,
  commentId: string,
  postId: string,
) {
  const rows = await adapter.$queryRawUnsafe<
    Array<{ id: string; postId: string }>
  >(
    `SELECT id, "postId"
     FROM "ForumComment"
     WHERE id = $1 AND "postId" = $2
     FOR UPDATE`,
    commentId,
    postId,
  );
  if (
    rows.length !== 1 ||
    rows[0]?.id !== commentId ||
    rows[0]?.postId !== postId
  ) {
    throw new ForumNotFoundError();
  }
}

interface ForumReportEvidence {
  campusId: string;
  commentPostId: string | null;
  id: string;
  status: string;
  targetId: string;
  targetType: string;
}

async function findActivePostEvidence(
  adapter: ForumAdapter,
  campusId: string,
  postId: string,
) {
  const rows = await adapter.$queryRawUnsafe<ForumReportEvidence[]>(
    `SELECT report.id,
            report."campusId" AS "campusId",
            report.status,
            report."targetId" AS "targetId",
            report."targetType" AS "targetType",
            comment."postId" AS "commentPostId"
     FROM "Report" AS report
     LEFT JOIN "ForumComment" AS comment
       ON report."targetType" = 'FORUM_COMMENT'
      AND comment.id = report."targetId"
     WHERE report."campusId" = $1
       AND report.status IN ('OPEN', 'TRIAGED')
       AND (
         (report."targetType" = 'FORUM_POST' AND report."targetId" = $2)
         OR
         (report."targetType" = 'FORUM_COMMENT' AND comment."postId" = $2)
       )
     ORDER BY report.id
     LIMIT 1`,
    campusId,
    postId,
  );
  if (rows.length === 0) return null;
  const evidence = rows[0];
  if (
    rows.length !== 1 ||
    !evidence ||
    evidence.campusId !== campusId ||
    typeof evidence.id !== 'string' ||
    (evidence.status !== 'OPEN' && evidence.status !== 'TRIAGED') ||
    (evidence.targetType === 'FORUM_POST'
      ? evidence.targetId !== postId
      : evidence.targetType !== 'FORUM_COMMENT' ||
        typeof evidence.targetId !== 'string' ||
        evidence.commentPostId !== postId)
  ) {
    throw new ForumConflictError();
  }
  return evidence;
}

function requireVerifiedForumActor(
  actor: ForumActor | null | undefined,
): asserts actor is ForumActor & { emailVerifiedAt: Date; status: 'ACTIVE' } {
  if (
    !actor ||
    actor.status !== 'ACTIVE' ||
    !(actor.emailVerifiedAt instanceof Date)
  ) {
    throw new ForumVerificationRequiredError();
  }
}

function kindForView(view: ForumView): ForumPostKind {
  if (view !== 'discussion' && view !== 'tree-hole') {
    throw new ForumValidationError();
  }
  return view === 'tree-hole' ? 'TREE_HOLE' : 'DISCUSSION';
}

type UniqueRetryScope = 'forum-like' | 'public-code';

function isSerializationFailure(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; meta?: { code?: unknown } };
  return (
    candidate.code === 'P2034' ||
    candidate.code === '40001' ||
    candidate.meta?.code === '40001'
  );
}

function matchesUniqueRetryScope(
  error: unknown,
  scope: UniqueRetryScope | undefined,
) {
  if (!scope || !error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: unknown;
    meta?: { constraint?: unknown; target?: unknown };
  };
  if (candidate.code !== 'P2002') return false;
  const target = candidate.meta?.target ?? candidate.meta?.constraint;
  if (scope === 'public-code') {
    return (
      target === 'ForumPost_publicCode_key' ||
      target === 'publicCode' ||
      (Array.isArray(target) &&
        target.length === 1 &&
        target[0] === 'publicCode')
    );
  }
  return (
    target === 'ForumLike_userId_postId_key' ||
    target === 'userId+postId' ||
    (Array.isArray(target) &&
      target.length === 2 &&
      target[0] === 'userId' &&
      target[1] === 'postId')
  );
}

async function serializableForumTransaction<T>(
  adapter: ForumAdapter,
  operation: (tx: ForumAdapter) => Promise<T>,
  uniqueRetryScope?: UniqueRetryScope,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await adapter.$transaction(operation, {
        isolationLevel: 'Serializable',
      });
    } catch (error) {
      const retryable =
        isSerializationFailure(error) ||
        matchesUniqueRetryScope(error, uniqueRetryScope);
      if (retryable && attempt < 2) continue;
      if (retryable) throw new ForumConflictError();
      throw error;
    }
  }
  throw new ForumConflictError();
}

async function resolveCampusId(
  adapter: ForumAdapter,
  actor: ForumActor | null,
) {
  if (actor) return actor.campusId;
  const slug = getDefaultCampusSlug();
  const campus = await adapter.campus.findFirst({
    select: { id: true, isActive: true, slug: true },
    where: { isActive: true, slug },
  });
  if (
    !campus ||
    campus.slug !== slug ||
    campus.isActive !== true ||
    typeof campus.id !== 'string'
  ) {
    throw new ForumNotFoundError();
  }
  return campus.id;
}

const sharedPostSelect = {
  _count: { select: { comments: true, likes: true } },
  body: true,
  campusId: true,
  category: true,
  createdAt: true,
  id: true,
  kind: true,
  status: true,
  title: true,
  updatedAt: true,
} as const;

function publicPostSelect(kind: ForumPostKind) {
  return kind === 'DISCUSSION'
    ? {
        ...sharedPostSelect,
        author: { select: { id: true, name: true } },
      }
    : { ...sharedPostSelect, publicCode: true };
}

function ownedPostSelect(kind: ForumPostKind) {
  return kind === 'DISCUSSION'
    ? {
        ...sharedPostSelect,
        author: { select: { id: true, name: true } },
        authorId: true,
      }
    : {
        ...sharedPostSelect,
        anonymousFingerprint: true,
        publicCode: true,
      };
}

function validCount(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function presentPublishedPost(
  record: Record<string, unknown>,
  campusId: string,
  kind: ForumPostKind,
  allowedStatuses: ReadonlySet<string> = new Set(['PUBLISHED']),
) {
  const count = record._count as Record<string, unknown> | undefined;
  const commonValid =
    record.campusId === campusId &&
    record.kind === kind &&
    typeof record.status === 'string' &&
    allowedStatuses.has(record.status) &&
    typeof record.id === 'string' &&
    typeof record.title === 'string' &&
    typeof record.body === 'string' &&
    typeof record.category === 'string' &&
    record.createdAt instanceof Date &&
    record.updatedAt instanceof Date &&
    count !== undefined &&
    validCount(count.comments) &&
    validCount(count.likes);
  if (!commonValid) throw new ForumNotFoundError();

  const common = {
    _count: { comments: Number(count.comments), likes: Number(count.likes) },
    body: record.body as string,
    category: record.category as string,
    createdAt: record.createdAt as Date,
    id: record.id as string,
    kind,
    status: record.status as string,
    title: record.title as string,
    updatedAt: record.updatedAt as Date,
  };
  if (kind === 'DISCUSSION') {
    const author = record.author as Record<string, unknown> | undefined;
    if (
      !author ||
      typeof author.id !== 'string' ||
      (author.name !== null && typeof author.name !== 'string')
    ) {
      throw new ForumNotFoundError();
    }
    return {
      ...common,
      author: { id: author.id, name: author.name as string | null },
    };
  }
  if (
    typeof record.publicCode !== 'string' ||
    !/^[A-Za-z0-9_-]{12}$/.test(record.publicCode)
  ) {
    throw new ForumNotFoundError();
  }
  return { ...common, publicCode: record.publicCode };
}

const ownedStatuses = new Set([
  'DRAFT',
  'PENDING',
  'PUBLISHED',
  'REJECTED',
  'HIDDEN',
  'ARCHIVED',
]);

function presentOwnedPost(
  record: Record<string, unknown>,
  campusId: string,
  kind: ForumPostKind,
) {
  const count = record._count as Record<string, unknown> | undefined;
  if (
    record.campusId !== campusId ||
    record.kind !== kind ||
    typeof record.status !== 'string' ||
    !ownedStatuses.has(record.status) ||
    typeof record.id !== 'string' ||
    typeof record.title !== 'string' ||
    typeof record.body !== 'string' ||
    typeof record.category !== 'string' ||
    !(record.createdAt instanceof Date) ||
    !(record.updatedAt instanceof Date) ||
    !count ||
    !validCount(count.comments) ||
    !validCount(count.likes)
  ) {
    throw new ForumNotFoundError();
  }
  const common = {
    _count: { comments: Number(count.comments), likes: Number(count.likes) },
    body: record.body as string,
    category: record.category as string,
    createdAt: record.createdAt as Date,
    id: record.id as string,
    kind,
    status: record.status,
    title: record.title as string,
    updatedAt: record.updatedAt as Date,
  };
  if (kind === 'DISCUSSION') {
    const author = record.author as Record<string, unknown> | undefined;
    if (
      !author ||
      typeof author.id !== 'string' ||
      (author.name !== null && typeof author.name !== 'string')
    ) {
      throw new ForumNotFoundError();
    }
    return {
      ...common,
      author: { id: author.id, name: author.name as string | null },
    };
  }
  if (
    typeof record.publicCode !== 'string' ||
    !/^[A-Za-z0-9_-]{12}$/.test(record.publicCode)
  ) {
    throw new ForumNotFoundError();
  }
  return { ...common, publicCode: record.publicCode };
}

function parseListQuery(input: ForumListQuery) {
  const parsed = forumListQuerySchema.safeParse(input);
  if (!parsed.success) throw new ForumValidationError();
  return parsed.data;
}

export async function listForumPosts(
  adapter: ForumAdapter,
  actor: ForumActor | null,
  rawQuery: ForumListQuery,
) {
  const query = parseListQuery(rawQuery);
  if (query.view === 'tree-hole') requireVerifiedForumActor(actor);
  const campusId = await resolveCampusId(adapter, actor);
  const kind = kindForView(query.view);
  const where = {
    campusId,
    ...(query.category ? { category: query.category } : {}),
    kind,
    ...(query.query
      ? {
          OR: [
            { title: { contains: query.query, mode: 'insensitive' } },
            { body: { contains: query.query, mode: 'insensitive' } },
          ],
        }
      : {}),
    status: 'PUBLISHED',
  };
  const [records, total] = await Promise.all([
    adapter.forumPost.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: publicPostSelect(kind),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      where,
    }),
    adapter.forumPost.count({ where }),
  ]);
  return {
    items: records.map((record) =>
      presentPublishedPost(record, campusId, kind),
    ),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function getForumPost(
  adapter: ForumAdapter,
  actor: ForumActor | null,
  input: { id: string; owner: boolean; view: ForumView },
  keys?: AnonymousIdentityKeyring,
) {
  if (
    typeof input.id !== 'string' ||
    input.id.length < 1 ||
    input.id.length > 191
  ) {
    throw new ForumValidationError();
  }
  kindForView(input.view);
  if (input.view === 'tree-hole') requireVerifiedForumActor(actor);
  if (input.owner) {
    requireVerifiedForumActor(actor);
    const { kind, record } = await findOwnedPost(
      adapter,
      actor,
      input.id,
      input.view,
      keys,
    );
    return presentOwnedPost(record, actor.campusId, kind);
  }
  const campusId = await resolveCampusId(adapter, actor);
  const kind = kindForView(input.view);
  const record = await adapter.forumPost.findFirst({
    select: publicPostSelect(kind),
    where: { campusId, id: input.id, kind, status: 'PUBLISHED' },
  });
  if (!record) throw new ForumNotFoundError();
  return presentPublishedPost(record, campusId, kind);
}

function ownedSummarySelect(kind: ForumPostKind) {
  return kind === 'TREE_HOLE'
    ? { ...sharedPostSelect, publicCode: true }
    : sharedPostSelect;
}

function presentOwnedSummary(
  record: Record<string, unknown>,
  campusId: string,
  kind: ForumPostKind,
) {
  const count = record._count as Record<string, unknown> | undefined;
  if (
    record.campusId !== campusId ||
    record.kind !== kind ||
    typeof record.status !== 'string' ||
    !ownedStatuses.has(record.status) ||
    typeof record.id !== 'string' ||
    typeof record.title !== 'string' ||
    typeof record.body !== 'string' ||
    typeof record.category !== 'string' ||
    !(record.createdAt instanceof Date) ||
    !(record.updatedAt instanceof Date) ||
    !count ||
    !validCount(count.comments) ||
    !validCount(count.likes)
  ) {
    throw new ForumNotFoundError();
  }
  const summary = {
    _count: { comments: Number(count.comments), likes: Number(count.likes) },
    body: record.body as string,
    category: record.category as string,
    createdAt: record.createdAt as Date,
    id: record.id as string,
    kind,
    status: record.status,
    title: record.title as string,
    updatedAt: record.updatedAt as Date,
  };
  if (kind === 'DISCUSSION') return summary;
  if (
    typeof record.publicCode !== 'string' ||
    !/^[A-Za-z0-9_-]{12}$/.test(record.publicCode)
  ) {
    throw new ForumNotFoundError();
  }
  return { ...summary, publicCode: record.publicCode };
}

export async function listOwnedForumPosts(
  adapter: ForumAdapter,
  actor: ForumActor,
  keys: AnonymousIdentityKeyring,
) {
  requireVerifiedForumActor(actor);
  const fingerprint = ownerFingerprint(actor, keys);
  const [discussions, treeHoles] = await Promise.all([
    adapter.forumPost.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: ownedSummarySelect('DISCUSSION'),
      take: 100,
      where: {
        authorId: actor.id,
        campusId: actor.campusId,
        kind: 'DISCUSSION',
      },
    }),
    adapter.forumPost.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: ownedSummarySelect('TREE_HOLE'),
      take: 100,
      where: {
        anonymousFingerprint: fingerprint,
        campusId: actor.campusId,
        kind: 'TREE_HOLE',
      },
    }),
  ]);
  return {
    discussions: discussions.map((record) =>
      presentOwnedSummary(record, actor.campusId, 'DISCUSSION'),
    ),
    treeHoles: treeHoles.map((record) =>
      presentOwnedSummary(record, actor.campusId, 'TREE_HOLE'),
    ),
  };
}

function ownerFingerprint(
  actor: ForumActor,
  keys: AnonymousIdentityKeyring | undefined,
) {
  if (!keys) throw new ForumConflictError();
  return fingerprintAnonymousUser(actor.id, keys);
}

async function findOwnedPost(
  adapter: ForumAdapter,
  actor: ForumActor,
  id: string,
  view: ForumView,
  keys?: AnonymousIdentityKeyring,
) {
  const kind = kindForView(view);
  const fingerprint =
    kind === 'TREE_HOLE' ? ownerFingerprint(actor, keys) : undefined;
  const record = await adapter.forumPost.findFirst({
    select: ownedPostSelect(kind),
    where: {
      ...(kind === 'DISCUSSION'
        ? { authorId: actor.id }
        : { anonymousFingerprint: fingerprint }),
      campusId: actor.campusId,
      id,
      kind,
    },
  });
  if (!record) throw new ForumNotFoundError();
  if (
    record.campusId !== actor.campusId ||
    record.id !== id ||
    record.kind !== kind
  ) {
    throw new ForumNotFoundError();
  }
  if (
    (kind === 'DISCUSSION' && record.authorId !== actor.id) ||
    (kind === 'TREE_HOLE' && record.anonymousFingerprint !== fingerprint)
  ) {
    throw new ForumForbiddenError();
  }
  return { kind, record };
}

function requireEditableForumRecord(record: Record<string, unknown>) {
  if (record.status === 'HIDDEN' || record.status === 'ARCHIVED') {
    throw new ForumConflictError();
  }
}

async function requireActiveCategory(
  adapter: ForumAdapter,
  campusId: string,
  slug: string,
) {
  const category = await adapter.forumCategory.findFirst({
    select: { campusId: true, isActive: true, slug: true },
    where: { campusId, isActive: true, slug },
  });
  if (
    !category ||
    category.campusId !== campusId ||
    category.isActive !== true ||
    category.slug !== slug
  ) {
    throw new ForumValidationError();
  }
}

function defaultPublicCode() {
  return randomBytes(9).toString('base64url');
}

export async function createForumPost(
  adapter: ForumAdapter,
  actor: ForumActor,
  rawInput: CreateForumPostInput,
  keys?: AnonymousIdentityKeyring,
  options: { generatePublicCode?: () => string } = {},
  publishing?: PublishingAssessmentPolicy,
) {
  requireVerifiedForumActor(actor);
  const parsed = createForumPostSchema.safeParse(rawInput);
  if (!parsed.success) throw new ForumValidationError();
  const input = parsed.data;
  if (publishing) {
    await requireActiveCategory(adapter, actor.campusId, input.category);
  }
  const assessment = await prepareForumPublishing(
    actor,
    publishing,
    'FORUM_POST',
    { body: input.body, title: input.title },
  );

  const result = await serializableForumTransaction(
    adapter,
    async (tx) => {
      await requireActiveCategory(tx, actor.campusId, input.category);
      if (input.kind === 'DISCUSSION') {
        const record = await tx.forumPost.create({
          data: {
            authorId: actor.id,
            body: input.body,
            campusId: actor.campusId,
            category: input.category,
            ...(assessment ? { id: assessment.targetId } : {}),
            kind: 'DISCUSSION',
            status: assessment
              ? publishingOutcomeStatus(assessment.prepared.outcome)
              : 'PUBLISHED',
            title: input.title,
          },
          select: publicPostSelect('DISCUSSION'),
        });
        if (assessment) {
          await persistPreparedAssessmentBatch(tx, assessment.prepared);
        }
        return presentPublishedPost(
          record,
          actor.campusId,
          'DISCUSSION',
          new Set(['PUBLISHED', 'PENDING', 'REJECTED']),
        );
      }

      if (!keys) throw new ForumConflictError();
      const envelope = sealAnonymousIdentity(actor.id, keys);
      const publicCode = (options.generatePublicCode ?? defaultPublicCode)();
      if (!/^[A-Za-z0-9_-]{12}$/.test(publicCode)) {
        throw new ForumValidationError();
      }
      const record = await tx.forumPost.create({
        data: {
          anonymousCiphertext: serializeAnonymousIdentityEnvelope(envelope),
          anonymousFingerprint: fingerprintAnonymousUser(actor.id, keys),
          anonymousKeyVersion: envelope.keyVersion,
          body: input.body,
          campusId: actor.campusId,
          category: input.category,
          ...(assessment ? { id: assessment.targetId } : {}),
          kind: 'TREE_HOLE',
          publicCode,
          status: assessment
            ? publishingOutcomeStatus(assessment.prepared.outcome)
            : 'PUBLISHED',
          title: input.title,
        },
        select: publicPostSelect('TREE_HOLE'),
      });
      if (assessment) {
        await persistPreparedAssessmentBatch(tx, assessment.prepared);
      }
      return presentPublishedPost(
        record,
        actor.campusId,
        'TREE_HOLE',
        new Set(['PUBLISHED', 'PENDING', 'REJECTED']),
      );
    },
    input.kind === 'TREE_HOLE' ? 'public-code' : undefined,
  );
  throwForumProviderBlock(assessment?.prepared);
  return result;
}

export async function updateForumPost(
  adapter: ForumAdapter,
  actor: ForumActor,
  rawInput: {
    changes: UpdateForumPostInput;
    id: string;
    view: ForumView;
  },
  keys?: AnonymousIdentityKeyring,
  publishing?: PublishingAssessmentPolicy,
) {
  requireVerifiedForumActor(actor);
  kindForView(rawInput.view);
  const parsed = updateForumPostSchema.safeParse(rawInput.changes);
  if (
    !parsed.success ||
    typeof rawInput.id !== 'string' ||
    rawInput.id.length < 1 ||
    rawInput.id.length > 191
  ) {
    throw new ForumValidationError();
  }
  let assessment: Awaited<ReturnType<typeof prepareForumPublishing>> = null;
  if (publishing) {
    const owned = await findOwnedPost(
      adapter,
      actor,
      rawInput.id,
      rawInput.view,
      keys,
    );
    requireEditableForumRecord(owned.record);
    if (parsed.data.category) {
      await requireActiveCategory(
        adapter,
        actor.campusId,
        parsed.data.category,
      );
    }
    const title = parsed.data.title ?? owned.record.title;
    const body = parsed.data.body ?? owned.record.body;
    if (typeof title !== 'string' || typeof body !== 'string') {
      throw new ForumConflictError();
    }
    assessment = await prepareForumPublishing(
      actor,
      publishing,
      'FORUM_POST',
      { body, title },
      rawInput.id,
    );
  }
  const result = await serializableForumTransaction(adapter, async (tx) => {
    const owned = await findOwnedPost(
      tx,
      actor,
      rawInput.id,
      rawInput.view,
      keys,
    );
    requireEditableForumRecord(owned.record);
    if (parsed.data.category) {
      await requireActiveCategory(tx, actor.campusId, parsed.data.category);
    }
    const updated = await tx.forumPost.update({
      data: {
        ...parsed.data,
        ...(assessment
          ? { status: publishingOutcomeStatus(assessment.prepared.outcome) }
          : {}),
      },
      select: ownedPostSelect(owned.kind),
      where: { id: rawInput.id },
    });
    if (
      updated.campusId !== actor.campusId ||
      updated.id !== rawInput.id ||
      updated.kind !== owned.kind ||
      (owned.kind === 'DISCUSSION' && updated.authorId !== actor.id) ||
      (owned.kind === 'TREE_HOLE' &&
        updated.anonymousFingerprint !== ownerFingerprint(actor, keys))
    ) {
      throw new ForumConflictError();
    }
    if (assessment) {
      await persistPreparedAssessmentBatch(tx, assessment.prepared);
    }
    return presentOwnedPost(updated, actor.campusId, owned.kind);
  });
  throwForumProviderBlock(assessment?.prepared);
  return result;
}

export async function deleteForumPost(
  adapter: ForumAdapter,
  actor: ForumActor,
  input: { id: string; view: ForumView },
  keys?: AnonymousIdentityKeyring,
) {
  requireVerifiedForumActor(actor);
  kindForView(input.view);
  if (
    typeof input.id !== 'string' ||
    input.id.length < 1 ||
    input.id.length > 191
  ) {
    throw new ForumValidationError();
  }
  return serializableForumTransaction(adapter, async (tx) => {
    await lockForumPost(tx, actor.campusId, input.id, 'update');
    await findOwnedPost(tx, actor, input.id, input.view, keys);
    const activeReport = await findActivePostEvidence(
      tx,
      actor.campusId,
      input.id,
    );
    if (activeReport) {
      await tx.forumPost.update({
        data: { status: 'ARCHIVED' },
        select: { id: true },
        where: { id: input.id },
      });
      return { archived: true, deleted: false, id: input.id };
    }
    await tx.forumPost.delete({
      select: { id: true },
      where: { id: input.id },
    });
    return { archived: false, deleted: true, id: input.id };
  });
}

const visiblePostSelect = {
  campusId: true,
  id: true,
  kind: true,
  status: true,
} as const;

async function findVisibleInteractionPost(
  adapter: ForumAdapter,
  campusId: string,
  postId: string,
) {
  const record = await adapter.forumPost.findFirst({
    select: visiblePostSelect,
    where: { campusId, id: postId, status: 'PUBLISHED' },
  });
  if (
    !record ||
    record.campusId !== campusId ||
    record.id !== postId ||
    record.status !== 'PUBLISHED' ||
    (record.kind !== 'DISCUSSION' && record.kind !== 'TREE_HOLE')
  ) {
    throw new ForumNotFoundError();
  }
  return record as Record<string, unknown> & { kind: ForumPostKind };
}

async function findVisibleDiscussionPost(
  adapter: ForumAdapter,
  campusId: string,
  postId: string,
) {
  const record = await adapter.forumPost.findFirst({
    select: visiblePostSelect,
    where: {
      campusId,
      id: postId,
      kind: 'DISCUSSION',
      status: 'PUBLISHED',
    },
  });
  if (
    !record ||
    record.campusId !== campusId ||
    record.id !== postId ||
    record.kind !== 'DISCUSSION' ||
    record.status !== 'PUBLISHED'
  ) {
    throw new ForumNotFoundError();
  }
}

const publicCommentSelect = {
  author: { select: { id: true, name: true } },
  body: true,
  createdAt: true,
  id: true,
  postId: true,
  status: true,
  updatedAt: true,
} as const;

function presentComment(
  record: Record<string, unknown>,
  postId: string,
  allowedStatuses: ReadonlySet<string> = new Set(['PUBLISHED']),
) {
  const author = record.author as Record<string, unknown> | undefined;
  if (
    record.postId !== postId ||
    typeof record.id !== 'string' ||
    typeof record.body !== 'string' ||
    typeof record.status !== 'string' ||
    !allowedStatuses.has(record.status) ||
    !(record.createdAt instanceof Date) ||
    !(record.updatedAt instanceof Date) ||
    !author ||
    typeof author.id !== 'string' ||
    (author.name !== null && typeof author.name !== 'string')
  ) {
    throw new ForumNotFoundError();
  }
  return {
    author: { id: author.id, name: author.name as string | null },
    body: record.body as string,
    createdAt: record.createdAt as Date,
    id: record.id as string,
    postId: record.postId as string,
    status: record.status as string,
    updatedAt: record.updatedAt as Date,
  };
}

function boundedPagination(value: { page: number; pageSize: number }) {
  if (
    !Number.isSafeInteger(value.page) ||
    value.page < 1 ||
    value.page > 10_000 ||
    !Number.isSafeInteger(value.pageSize) ||
    value.pageSize < 1 ||
    value.pageSize > 50
  ) {
    throw new ForumValidationError();
  }
}

export async function listForumComments(
  adapter: ForumAdapter,
  actor: ForumActor | null,
  input: { page: number; pageSize: number; postId: string },
) {
  boundedPagination(input);
  if (!/^[A-Za-z0-9_-]{1,191}$/.test(input.postId)) {
    throw new ForumValidationError();
  }
  const campusId = await resolveCampusId(adapter, actor);
  await findVisibleDiscussionPost(adapter, campusId, input.postId);
  const where = {
    postId: input.postId,
    status: 'PUBLISHED',
  };
  const [records, total] = await Promise.all([
    adapter.forumComment.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: publicCommentSelect,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      where,
    }),
    adapter.forumComment.count({ where }),
  ]);
  return {
    items: records.map((record) => presentComment(record, input.postId)),
    page: input.page,
    pageSize: input.pageSize,
    total,
  };
}

export async function createForumComment(
  adapter: ForumAdapter,
  actor: ForumActor,
  rawInput: { body: string; postId: string },
  publishing?: PublishingAssessmentPolicy,
) {
  requireVerifiedForumActor(actor);
  const body = createForumCommentSchema.safeParse({ body: rawInput.body });
  if (!body.success || !/^[A-Za-z0-9_-]{1,191}$/.test(rawInput.postId)) {
    throw new ForumValidationError();
  }
  if (publishing) {
    const post = await findVisibleInteractionPost(
      adapter,
      actor.campusId,
      rawInput.postId,
    );
    if (post.kind === 'TREE_HOLE') throw new ForumNotFoundError();
  }
  const assessment = await prepareForumPublishing(
    actor,
    publishing,
    'FORUM_COMMENT',
    { comment: body.data.body },
  );
  const result = await serializableForumTransaction(adapter, async (tx) => {
    const post = await findVisibleInteractionPost(
      tx,
      actor.campusId,
      rawInput.postId,
    );
    if (post.kind === 'TREE_HOLE') throw new ForumNotFoundError();
    const created = await tx.forumComment.create({
      data: {
        authorId: actor.id,
        body: body.data.body,
        ...(assessment ? { id: assessment.targetId } : {}),
        postId: rawInput.postId,
        status: assessment
          ? publishingOutcomeStatus(assessment.prepared.outcome)
          : 'PUBLISHED',
      },
      select: publicCommentSelect,
    });
    if (assessment) {
      await persistPreparedAssessmentBatch(tx, assessment.prepared);
    }
    return presentComment(
      created,
      rawInput.postId,
      new Set(['PUBLISHED', 'PENDING', 'REJECTED']),
    );
  });
  throwForumProviderBlock(assessment?.prepared);
  return result;
}

const ownedCommentSelect = {
  ...publicCommentSelect,
  authorId: true,
  post: { select: visiblePostSelect },
} as const;

async function findOwnedComment(
  adapter: ForumAdapter,
  actor: ForumActor,
  postId: string,
  commentId: string,
) {
  const comment = await adapter.forumComment.findFirst({
    select: ownedCommentSelect,
    where: {
      authorId: actor.id,
      id: commentId,
      post: {
        campusId: actor.campusId,
        kind: 'DISCUSSION',
        status: 'PUBLISHED',
      },
      postId,
    },
  });
  if (!comment) throw new ForumNotFoundError();
  const post = comment.post as Record<string, unknown> | undefined;
  if (
    comment.id !== commentId ||
    comment.postId !== postId ||
    !post ||
    post.id !== postId ||
    post.campusId !== actor.campusId ||
    post.kind !== 'DISCUSSION' ||
    post.status !== 'PUBLISHED'
  ) {
    throw new ForumNotFoundError();
  }
  if (comment.authorId !== actor.id) throw new ForumForbiddenError();
  return comment;
}

export async function updateForumComment(
  adapter: ForumAdapter,
  actor: ForumActor,
  rawInput: { body: string; commentId: string; postId: string },
  publishing?: PublishingAssessmentPolicy,
) {
  requireVerifiedForumActor(actor);
  const parsed = updateForumCommentSchema.safeParse({
    body: rawInput.body,
    commentId: rawInput.commentId,
  });
  if (!parsed.success || !/^[A-Za-z0-9_-]{1,191}$/.test(rawInput.postId)) {
    throw new ForumValidationError();
  }
  if (publishing) {
    const owned = await findOwnedComment(
      adapter,
      actor,
      rawInput.postId,
      parsed.data.commentId,
    );
    requireEditableForumRecord(owned);
  }
  const assessment = await prepareForumPublishing(
    actor,
    publishing,
    'FORUM_COMMENT',
    { comment: parsed.data.body },
    parsed.data.commentId,
  );
  const result = await serializableForumTransaction(adapter, async (tx) => {
    const owned = await findOwnedComment(
      tx,
      actor,
      rawInput.postId,
      parsed.data.commentId,
    );
    requireEditableForumRecord(owned);
    const updated = await tx.forumComment.update({
      data: {
        body: parsed.data.body,
        ...(assessment
          ? { status: publishingOutcomeStatus(assessment.prepared.outcome) }
          : {}),
      },
      select: publicCommentSelect,
      where: { id: parsed.data.commentId },
    });
    if (assessment) {
      await persistPreparedAssessmentBatch(tx, assessment.prepared);
    }
    return presentComment(
      updated,
      rawInput.postId,
      new Set(['PUBLISHED', 'PENDING', 'REJECTED']),
    );
  });
  throwForumProviderBlock(assessment?.prepared);
  return result;
}

export async function deleteForumComment(
  adapter: ForumAdapter,
  actor: ForumActor,
  rawInput: { commentId: string; postId: string },
) {
  requireVerifiedForumActor(actor);
  const parsed = deleteForumCommentSchema.safeParse({
    commentId: rawInput.commentId,
  });
  if (!parsed.success || !/^[A-Za-z0-9_-]{1,191}$/.test(rawInput.postId)) {
    throw new ForumValidationError();
  }
  return serializableForumTransaction(adapter, async (tx) => {
    await lockForumPost(tx, actor.campusId, rawInput.postId, 'key-share');
    await lockForumCommentForUpdate(tx, parsed.data.commentId, rawInput.postId);
    await findOwnedComment(tx, actor, rawInput.postId, parsed.data.commentId);
    const activeReport = await tx.report.findFirst({
      select: {
        campusId: true,
        id: true,
        status: true,
        targetId: true,
        targetType: true,
      },
      where: {
        campusId: actor.campusId,
        status: { in: ['OPEN', 'TRIAGED'] },
        targetId: parsed.data.commentId,
        targetType: 'FORUM_COMMENT',
      },
    });
    if (activeReport) {
      if (
        activeReport.campusId !== actor.campusId ||
        activeReport.targetId !== parsed.data.commentId ||
        activeReport.targetType !== 'FORUM_COMMENT' ||
        (activeReport.status !== 'OPEN' && activeReport.status !== 'TRIAGED')
      ) {
        throw new ForumConflictError();
      }
      await tx.forumComment.update({
        data: { status: 'ARCHIVED' },
        select: { id: true },
        where: { id: parsed.data.commentId },
      });
      return { archived: true, deleted: false, id: parsed.data.commentId };
    }
    await tx.forumComment.delete({
      select: { id: true },
      where: { id: parsed.data.commentId },
    });
    return { archived: false, deleted: true, id: parsed.data.commentId };
  });
}

export async function toggleForumLike(
  adapter: ForumAdapter,
  actor: ForumActor,
  input: { postId: string },
) {
  requireVerifiedForumActor(actor);
  if (!/^[A-Za-z0-9_-]{1,191}$/.test(input.postId)) {
    throw new ForumValidationError();
  }
  return serializableForumTransaction(
    adapter,
    async (tx) => {
      await findVisibleInteractionPost(tx, actor.campusId, input.postId);
      const existing = await tx.forumLike.findUnique({
        select: { id: true, postId: true, userId: true },
        where: {
          userId_postId: { postId: input.postId, userId: actor.id },
        },
      });
      let liked: boolean;
      if (existing) {
        if (existing.postId !== input.postId || existing.userId !== actor.id) {
          throw new ForumConflictError();
        }
        const removed = await tx.forumLike.deleteMany({
          where: { postId: input.postId, userId: actor.id },
        });
        if (removed.count !== 1) throw new ForumConflictError();
        liked = false;
      } else {
        const created = await tx.forumLike.create({
          data: { postId: input.postId, userId: actor.id },
          select: { id: true, postId: true, userId: true },
        });
        if (created.postId !== input.postId || created.userId !== actor.id) {
          throw new ForumConflictError();
        }
        liked = true;
      }
      const likeCount = await tx.forumLike.count({
        where: { postId: input.postId },
      });
      if (!validCount(likeCount)) throw new ForumConflictError();
      return { liked, likeCount };
    },
    'forum-like',
  );
}
