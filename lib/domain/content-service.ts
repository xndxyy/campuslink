import { randomUUID } from 'node:crypto';

import { ContentStatus } from './content-status';
import { getDefaultCampusSlug } from '@/lib/config';
import {
  ContentBlockedError,
  persistPreparedAssessmentBatch,
  publishingOutcomeStatus,
  type PreparedAssessmentBatch,
  type PublishingAssessmentBatchInput,
} from '@/lib/moderation/content-assessment';
import {
  prepareContentTagSelection,
  resolveContentTagsInTransaction,
  TagConflictError,
  type TagResolutionTransaction,
} from '@/lib/domain/tags';
import type {
  ContentListQuery,
  CreateCampusWorkInput,
  CreateMarketplaceItemInput,
  CreateResourceInput,
  UpdateCampusWorkInput,
  UpdateMarketplaceItemInput,
  UpdateResourceInput,
} from '@/lib/validation/content';

type Role = 'STUDENT' | 'MODERATOR' | 'ADMIN';
export type ContentKind = 'resource' | 'marketplace' | 'campus-work';
export type UpdateContentInput =
  UpdateResourceInput | UpdateMarketplaceItemInput | UpdateCampusWorkInput;

export interface ContentActor {
  campusId: string;
  id: string;
  role: Role;
}

export interface VerifiedContentActor extends ContentActor {
  emailVerifiedAt: Date;
  status: 'ACTIVE';
}

function isVerifiedContentActor(
  actor: ContentActor,
): actor is VerifiedContentActor {
  return (
    'status' in actor &&
    actor.status === 'ACTIVE' &&
    'emailVerifiedAt' in actor &&
    actor.emailVerifiedAt instanceof Date
  );
}

interface AssetRecord {
  announcement?: {
    campus: { isActive: boolean; slug: string };
    campusId: string;
    id: string;
  } | null;
  id: string;
  kind:
    | 'ANNOUNCEMENT_IMAGE'
    | 'RESOURCE_DOCUMENT'
    | 'RESOURCE_IMAGE'
    | 'MARKETPLACE_IMAGE';
  marketplaceItemId: string | null;
  ownerId: string;
  resourceId: string | null;
  scanStatus?: 'NOT_REQUIRED' | 'PENDING' | 'CLEAN' | 'INFECTED' | 'ERROR';
  status: string;
}

interface DocumentScanPolicy {
  requireCleanDocuments?: boolean;
}

function requireCleanDocuments(policy?: DocumentScanPolicy) {
  return policy?.requireCleanDocuments ?? process.env.NODE_ENV === 'production';
}

export interface ContentRecord {
  createdAt?: Date;
  id: string;
  status?: string;
  [key: string]: unknown;
}

interface Delegate {
  count?: (args: Record<string, unknown>) => Promise<number>;
  create: (args: { data: Record<string, unknown> }) => Promise<ContentRecord>;
  findFirst?: (args: Record<string, unknown>) => Promise<ContentRecord | null>;
  findMany?: (args: Record<string, unknown>) => Promise<ContentRecord[]>;
  update: (args: {
    data: Record<string, unknown>;
    where: { id: string };
  }) => Promise<ContentRecord>;
  updateMany?: (args: {
    data: Record<string, unknown>;
    where: Record<string, unknown>;
  }) => Promise<{ count: number }>;
}

interface TagJoinDelegate {
  createMany(args: {
    data: Array<Record<string, unknown>>;
  }): Promise<{ count: number }>;
  deleteMany(args: {
    where: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

export interface ContentAdapter {
  $transaction<T>(
    operation: (tx: ContentAdapter) => Promise<T>,
    options?: { isolationLevel: 'Serializable' },
  ): Promise<T>;
  asset: {
    findFirst?(
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown> | null>;
    findMany(args: { where: { id: { in: string[] } } }): Promise<AssetRecord[]>;
    updateMany(args: {
      data: { marketplaceItemId?: string; resourceId?: string };
      where: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  auditLog: {
    create(args: Record<string, unknown>): Promise<unknown>;
  };
  campusWorkPost: Delegate;
  campusWorkTag: TagJoinDelegate;
  contentAssessment: {
    create(args: Record<string, unknown>): Promise<{ id: string }>;
  };
  marketplaceItem: Delegate;
  marketplaceTag: TagJoinDelegate;
  moderationAction?: {
    findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
  resource: Delegate;
  resourceTag: TagJoinDelegate;
  tagDefinition: TagResolutionTransaction['tagDefinition'];
}

export interface ContentPublishingPolicy {
  generateTargetId?: () => string;
  prepare(
    input: PublishingAssessmentBatchInput,
  ): Promise<PreparedAssessmentBatch>;
}

export class ContentConflictError extends Error {
  constructor(message = 'Content or asset state conflict') {
    super(message);
  }
}

export class ContentForbiddenError extends Error {
  constructor() {
    super('Content access is forbidden');
  }
}

export class ContentAuthenticationRequiredError extends Error {
  constructor() {
    super('A verified account is required to read this asset');
  }
}

export class ContentNotFoundError extends Error {
  constructor() {
    super('Content was not found');
  }
}

function isRetryableTransactionError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; meta?: { code?: unknown } };
  return (
    candidate.code === 'P2002' ||
    candidate.code === 'P2034' ||
    candidate.code === '40001' ||
    candidate.meta?.code === '40001'
  );
}

async function serializableContentTransaction<T>(
  adapter: ContentAdapter,
  operation: (tx: ContentAdapter) => Promise<T>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await adapter.$transaction(operation, {
        isolationLevel: 'Serializable',
      });
    } catch (error) {
      if (isRetryableTransactionError(error) && attempt < 2) continue;
      if (
        isRetryableTransactionError(error) ||
        error instanceof TagConflictError
      ) {
        throw new ContentConflictError();
      }
      throw error;
    }
  }
  throw new ContentConflictError();
}

async function writeResolvedTagJoins(
  transaction: ContentAdapter,
  actor: VerifiedContentActor,
  kind: 'resource' | 'marketplace' | 'campus-work',
  contentId: string,
  tagIds: string[],
  replace: boolean,
) {
  const delegate =
    kind === 'resource'
      ? transaction.resourceTag
      : kind === 'marketplace'
        ? transaction.marketplaceTag
        : transaction.campusWorkTag;
  const contentIdField =
    kind === 'resource'
      ? 'resourceId'
      : kind === 'marketplace'
        ? 'marketplaceItemId'
        : 'campusWorkPostId';
  if (replace) {
    await delegate.deleteMany({ where: { [contentIdField]: contentId } });
  }
  if (tagIds.length === 0) return;
  const scope =
    kind === 'resource'
      ? 'RESOURCE'
      : kind === 'marketplace'
        ? 'MARKETPLACE'
        : 'CAMPUS_WORK';
  const created = await delegate.createMany({
    data: tagIds.map((tagId) => ({
      campusId: actor.campusId,
      [contentIdField]: contentId,
      scope,
      tagId,
    })),
  });
  if (created.count !== tagIds.length) throw new ContentConflictError();
}

function delegateFor(adapter: ContentAdapter, kind: ContentKind): Delegate {
  return kind === 'resource'
    ? adapter.resource
    : kind === 'marketplace'
      ? adapter.marketplaceItem
      : adapter.campusWorkPost;
}

function validateAssets(
  assets: AssetRecord[],
  assetIds: string[],
  actor: ContentActor,
  allowedKinds: AssetRecord['kind'][],
  policy?: DocumentScanPolicy,
) {
  if (
    assets.length !== assetIds.length ||
    assets.some(
      (asset) =>
        asset.ownerId !== actor.id ||
        asset.status !== 'READY' ||
        !allowedKinds.includes(asset.kind) ||
        asset.resourceId !== null ||
        asset.marketplaceItemId !== null,
    )
  ) {
    throw new ContentConflictError();
  }
  if (
    requireCleanDocuments(policy) &&
    assets.some(
      (asset) =>
        asset.kind === 'RESOURCE_DOCUMENT' && asset.scanStatus !== 'CLEAN',
    )
  ) {
    throw new ContentConflictError('Document malware scan has not passed');
  }
}

function assessmentRequests(
  kind: 'RESOURCE' | 'MARKETPLACE_ITEM' | 'CAMPUS_WORK',
  targetId: string,
  content: Readonly<Record<string, string>>,
  customTags: ReadonlyArray<{ label: string }>,
) {
  return [
    { content, targetId, targetType: kind },
    ...customTags.map(({ label }, index) => ({
      content: { tag: label },
      targetId: `${targetId}:tag:${index}`,
      targetType: 'CUSTOM_TAG' as const,
    })),
  ];
}

async function prepareContentPublishing(
  actor: VerifiedContentActor,
  policy: ContentPublishingPolicy | undefined,
  requests: (targetId: string) => PublishingAssessmentBatchInput['requests'],
  existingTargetId?: string,
) {
  if (!policy) return null;
  const targetId =
    existingTargetId ?? (policy.generateTargetId ?? randomUUID)();
  const prepared = await policy.prepare({
    campusId: actor.campusId,
    requests: requests(targetId),
  });
  if (
    prepared.outcome.kind === 'block' &&
    prepared.outcome.source === 'local'
  ) {
    throw new ContentBlockedError(prepared.outcome);
  }
  return { prepared, targetId };
}

function throwProviderBlock(prepared: PreparedAssessmentBatch | undefined) {
  if (prepared?.outcome.kind === 'block') {
    throw new ContentBlockedError(prepared.outcome);
  }
}

export async function createResource(
  adapter: ContentAdapter,
  actor: VerifiedContentActor,
  input: CreateResourceInput,
  policy?: DocumentScanPolicy,
  publishing?: ContentPublishingPolicy,
) {
  const preparedTags = await prepareContentTagSelection(actor, 'RESOURCE', {
    customTags: input.customTags,
    presetTagIds: input.presetTagIds,
  });
  if (publishing) {
    const assets = await adapter.asset.findMany({
      where: { id: { in: input.assetIds } },
    });
    validateAssets(
      assets,
      input.assetIds,
      actor,
      ['RESOURCE_DOCUMENT', 'RESOURCE_IMAGE'],
      policy,
    );
    if (!assets.some((asset) => asset.kind === 'RESOURCE_DOCUMENT')) {
      throw new ContentConflictError('Resource requires a document');
    }
  }
  const assessment = await prepareContentPublishing(
    actor,
    publishing,
    (targetId) =>
      assessmentRequests(
        'RESOURCE',
        targetId,
        { summary: input.summary, title: input.title },
        preparedTags.customTags,
      ),
  );
  const result = await serializableContentTransaction(adapter, async (tx) => {
    const assets = await tx.asset.findMany({
      where: { id: { in: input.assetIds } },
    });
    validateAssets(
      assets,
      input.assetIds,
      actor,
      ['RESOURCE_DOCUMENT', 'RESOURCE_IMAGE'],
      policy,
    );
    if (!assets.some((asset) => asset.kind === 'RESOURCE_DOCUMENT')) {
      throw new ContentConflictError('Resource requires a document');
    }
    const created = await tx.resource.create({
      data: {
        authorId: actor.id,
        campusId: actor.campusId,
        ...(assessment ? { id: assessment.targetId } : {}),
        status: ContentStatus.DRAFT,
        summary: input.summary,
        title: input.title,
      },
    });
    const resolvedTagIds = await resolveContentTagsInTransaction(
      tx,
      preparedTags,
    );
    await writeResolvedTagJoins(
      tx,
      actor,
      'resource',
      created.id,
      resolvedTagIds,
      false,
    );
    const attached = await tx.asset.updateMany({
      data: { resourceId: created.id },
      where: {
        id: { in: input.assetIds },
        kind: { in: ['RESOURCE_DOCUMENT', 'RESOURCE_IMAGE'] },
        marketplaceItemId: null,
        ownerId: actor.id,
        resourceId: null,
        status: 'READY',
      },
    });
    if (attached.count !== input.assetIds.length)
      throw new ContentConflictError();
    if (assessment && created.id !== assessment.targetId) {
      throw new ContentConflictError();
    }
    if (assessment) {
      await persistPreparedAssessmentBatch(tx, assessment.prepared);
    }
    return tx.resource.update({
      data: {
        status: assessment
          ? publishingOutcomeStatus(assessment.prepared.outcome)
          : ContentStatus.PENDING,
      },
      where: { id: created.id },
    });
  });
  throwProviderBlock(assessment?.prepared);
  return result;
}

export async function createMarketplaceItem(
  adapter: ContentAdapter,
  actor: VerifiedContentActor,
  input: CreateMarketplaceItemInput,
  publishing?: ContentPublishingPolicy,
) {
  const preparedTags = await prepareContentTagSelection(actor, 'MARKETPLACE', {
    customTags: input.customTags,
    presetTagIds: input.presetTagIds,
  });
  if (publishing) {
    const assets = await adapter.asset.findMany({
      where: { id: { in: input.assetIds } },
    });
    validateAssets(assets, input.assetIds, actor, ['MARKETPLACE_IMAGE']);
  }
  const assessment = await prepareContentPublishing(
    actor,
    publishing,
    (targetId) =>
      assessmentRequests(
        'MARKETPLACE_ITEM',
        targetId,
        {
          description: input.description,
          location: input.pickupArea,
          title: input.title,
        },
        preparedTags.customTags,
      ),
  );
  const result = await serializableContentTransaction(adapter, async (tx) => {
    const assets = await tx.asset.findMany({
      where: { id: { in: input.assetIds } },
    });
    validateAssets(assets, input.assetIds, actor, ['MARKETPLACE_IMAGE']);
    const created = await tx.marketplaceItem.create({
      data: {
        campusId: actor.campusId,
        condition: input.condition,
        contact: input.contact,
        description: input.description,
        ...(assessment ? { id: assessment.targetId } : {}),
        pickupArea: input.pickupArea,
        priceCents: input.priceCents,
        sellerId: actor.id,
        status: ContentStatus.DRAFT,
        title: input.title,
      },
    });
    const resolvedTagIds = await resolveContentTagsInTransaction(
      tx,
      preparedTags,
    );
    await writeResolvedTagJoins(
      tx,
      actor,
      'marketplace',
      created.id,
      resolvedTagIds,
      false,
    );
    const attached = await tx.asset.updateMany({
      data: { marketplaceItemId: created.id },
      where: {
        id: { in: input.assetIds },
        kind: 'MARKETPLACE_IMAGE',
        marketplaceItemId: null,
        ownerId: actor.id,
        resourceId: null,
        status: 'READY',
      },
    });
    if (attached.count !== input.assetIds.length)
      throw new ContentConflictError();
    if (assessment && created.id !== assessment.targetId) {
      throw new ContentConflictError();
    }
    if (assessment) {
      await persistPreparedAssessmentBatch(tx, assessment.prepared);
    }
    return tx.marketplaceItem.update({
      data: {
        status: assessment
          ? publishingOutcomeStatus(assessment.prepared.outcome)
          : ContentStatus.PENDING,
      },
      where: { id: created.id },
    });
  });
  throwProviderBlock(assessment?.prepared);
  return result;
}

function sharedCampusWorkData(input: CreateCampusWorkInput) {
  return {
    description: input.description,
    location: input.location,
    payText: input.payText,
    title: input.title,
  };
}

export async function createCampusWorkPost(
  adapter: ContentAdapter,
  actor: VerifiedContentActor,
  input: CreateCampusWorkInput,
  publishing?: ContentPublishingPolicy,
) {
  const preparedTags = await prepareContentTagSelection(actor, 'CAMPUS_WORK', {
    customTags: input.customTags,
    presetTagIds: input.presetTagIds,
  });
  const assessment = await prepareContentPublishing(
    actor,
    publishing,
    (targetId) =>
      assessmentRequests(
        'CAMPUS_WORK',
        targetId,
        {
          description: input.description,
          location: input.location,
          payText: input.payText,
          title: input.title,
        },
        preparedTags.customTags,
      ),
  );
  const result = await serializableContentTransaction(adapter, async (tx) => {
    const id = assessment?.targetId ?? randomUUID();
    await tx.campusWorkPost.create({
      data: {
        authorId: actor.id,
        campusId: actor.campusId,
        contact: input.contact,
        ...sharedCampusWorkData(input),
        id,
        status: ContentStatus.DRAFT,
      },
    });
    const resolvedTagIds = await resolveContentTagsInTransaction(
      tx,
      preparedTags,
    );
    await writeResolvedTagJoins(
      tx,
      actor,
      'campus-work',
      id,
      resolvedTagIds,
      false,
    );
    if (assessment) {
      await persistPreparedAssessmentBatch(tx, assessment.prepared);
    }
    const updated = await tx.campusWorkPost.update({
      data: {
        status: assessment
          ? publishingOutcomeStatus(assessment.prepared.outcome)
          : ContentStatus.PENDING,
      },
      where: { id },
    });
    return updated;
  });
  throwProviderBlock(assessment?.prepared);
  return result;
}

function publicWhere(
  kind: ContentKind,
  query: Partial<ContentListQuery> & { campusId?: string },
) {
  const searchableFields =
    kind === 'resource'
      ? ['title', 'summary']
      : kind === 'marketplace'
        ? ['title', 'description', 'pickupArea']
        : ['title', 'description', 'location', 'payText'];
  const search = query.search
    ? {
        OR: searchableFields.map((field) => ({
          [field]: {
            contains: query.search,
            mode: 'insensitive',
          },
        })),
      }
    : {};
  return {
    ...(kind === 'campus-work' && !query.campusId
      ? {
          campus: { isActive: true, slug: getDefaultCampusSlug() },
        }
      : { campusId: query.campusId }),
    status: ContentStatus.PUBLISHED,
    ...search,
    ...((kind === 'resource' ||
      kind === 'marketplace' ||
      kind === 'campus-work') &&
    query.tag
      ? {
          tagAssignments: {
            some: {
              tag: {
                label: { equals: query.tag, mode: 'insensitive' },
              },
            },
          },
        }
      : {}),
    ...(kind === 'marketplace' && query.condition
      ? { condition: query.condition }
      : {}),
    ...(kind === 'marketplace' &&
    (query.minPriceCents !== undefined || query.maxPriceCents !== undefined)
      ? {
          priceCents: {
            gte: query.minPriceCents,
            lte: query.maxPriceCents,
          },
        }
      : {}),
    ...(kind === 'campus-work' && query.location
      ? { location: { contains: query.location, mode: 'insensitive' } }
      : {}),
  };
}

function publicSelect(kind: ContentKind) {
  const shared = {
    createdAt: true,
    id: true,
    status: true,
    title: true,
    updatedAt: true,
  };
  if (kind === 'resource') {
    return {
      ...shared,
      assets: {
        select: { contentType: true, id: true, kind: true, sizeBytes: true },
        where: { status: 'READY' },
      },
      author: { select: { name: true } },
      summary: true,
      tagAssignments: {
        select: {
          tag: {
            select: {
              id: true,
              isActive: true,
              isPreset: true,
              label: true,
            },
          },
        },
      },
    };
  }
  if (kind === 'marketplace') {
    return {
      ...shared,
      assets: {
        select: { contentType: true, id: true, kind: true, sizeBytes: true },
        where: { status: 'READY' },
      },
      condition: true,
      description: true,
      pickupArea: true,
      priceCents: true,
      seller: { select: { name: true } },
      tagAssignments: {
        select: {
          tag: {
            select: {
              id: true,
              isActive: true,
              isPreset: true,
              label: true,
            },
          },
        },
      },
      // Contact is deliberately absent until the audited request-contact flow.
    };
  }
  return {
    ...shared,
    author: { select: { name: true } },
    description: true,
    location: true,
    payText: true,
    tagAssignments: {
      select: {
        tag: {
          select: {
            id: true,
            isActive: true,
            isPreset: true,
            label: true,
          },
        },
      },
    },
    // Contact is deliberately absent from the public campus-work presenter.
  };
}

function presentContentRecord(record: ContentRecord) {
  if (!Array.isArray(record.tagAssignments)) return record;
  const tags = record.tagAssignments
    .flatMap((assignment) => {
      if (!assignment || typeof assignment !== 'object') return [];
      const tag = (assignment as { tag?: unknown }).tag;
      if (!tag || typeof tag !== 'object') return [];
      const candidate = tag as Record<string, unknown>;
      if (
        typeof candidate.id !== 'string' ||
        typeof candidate.label !== 'string' ||
        typeof candidate.isActive !== 'boolean' ||
        typeof candidate.isPreset !== 'boolean'
      ) {
        return [];
      }
      return [
        {
          id: candidate.id,
          isActive: candidate.isActive,
          isPreset: candidate.isPreset,
          label: candidate.label,
        },
      ];
    })
    .sort((left, right) =>
      left.label === right.label
        ? left.id.localeCompare(right.id)
        : left.label.localeCompare(right.label, 'zh-CN'),
    );
  const content = { ...record };
  delete content.tagAssignments;
  return { ...content, tags };
}

function presentPublicContentRecord(record: ContentRecord) {
  const content = { ...presentContentRecord(record) };
  delete content.contact;
  return content;
}

export async function listPublicContent(
  adapter: ContentAdapter,
  kind: ContentKind,
  query: Partial<ContentListQuery> & { campusId?: string },
) {
  // Keep offset pagination bounded so public discovery cannot request
  // unbounded database scans while preserving stable page URLs.
  const page = Math.min(Math.max(query.page ?? 1, 1), 50);
  const pageSize = Math.min(Math.max(query.pageSize ?? 12, 1), 50);
  const delegate = delegateFor(adapter, kind);
  if (!delegate.findMany || !delegate.count)
    throw new Error('Unsupported adapter');
  const where = publicWhere(kind, query);
  const [items, total] = await Promise.all([
    delegate.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: publicSelect(kind),
      skip: (page - 1) * pageSize,
      take: pageSize,
      where,
    }),
    delegate.count({ where }),
  ]);
  const campusWorkWithContact =
    kind === 'campus-work' && items.length > 0
      ? await delegate.findMany({
          select: { id: true },
          take: Math.min(items.length, 50),
          where: {
            contact: { not: null },
            id: { in: items.map((item) => String(item.id)) },
          },
        })
      : [];
  const contactIds = new Set(
    campusWorkWithContact.map((item) => String(item.id)),
  );
  return {
    items: items.map((item) => ({
      ...presentPublicContentRecord(item),
      ...(kind === 'campus-work'
        ? { hasContact: contactIds.has(String(item.id)) }
        : {}),
    })),
    page,
    pageSize,
    total,
  };
}

export async function getPublicContent(
  adapter: ContentAdapter,
  kind: ContentKind,
  id: string,
) {
  const delegate = delegateFor(adapter, kind);
  if (!delegate.findFirst) throw new Error('Unsupported adapter');
  const item = await delegate.findFirst({
    select: publicSelect(kind),
    where: {
      ...(kind === 'campus-work'
        ? { campus: { isActive: true, slug: getDefaultCampusSlug() } }
        : {}),
      id,
      status: ContentStatus.PUBLISHED,
    },
  });
  if (!item) return null;
  const contactAvailable =
    kind === 'campus-work'
      ? await delegate.findFirst({
          select: { id: true },
          where: { contact: { not: null }, id },
        })
      : null;
  return {
    ...presentPublicContentRecord(item),
    ...(kind === 'campus-work'
      ? { hasContact: contactAvailable !== null }
      : {}),
  };
}

export async function listOwnedContent(
  adapter: ContentAdapter,
  actor: ContentActor,
  kind: ContentKind,
): Promise<
  Array<
    ContentRecord & {
      decisionAction: string | null;
      decisionReason: string | null;
    }
  >
> {
  const delegate = delegateFor(adapter, kind);
  if (!delegate.findMany) throw new Error('Unsupported adapter');
  const ownerField = kind === 'marketplace' ? 'sellerId' : 'authorId';
  const items = await delegate.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      ...publicSelect(kind),
      ...(kind === 'marketplace' || kind === 'campus-work'
        ? { contact: true }
        : {}),
    },
    where: { [ownerField]: actor.id },
  });
  const presentedItems = items.map(presentContentRecord);
  if (!adapter.moderationAction || items.length === 0) {
    return presentedItems.map((item) => ({
      ...(item as ContentRecord),
      decisionAction: null,
      decisionReason: null,
    })) as Array<
      ContentRecord & {
        decisionAction: string | null;
        decisionReason: string | null;
      }
    >;
  }
  const subjectType =
    kind === 'resource'
      ? 'RESOURCE'
      : kind === 'marketplace'
        ? 'MARKETPLACE_ITEM'
        : 'JOB_POST';
  const decisions = await adapter.moderationAction.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      action: true,
      createdAt: true,
      id: true,
      reason: true,
      subjectId: true,
    },
    where: {
      action: {
        in: ['APPROVE', 'REJECT', 'HIDE', 'RESTORE', 'ARCHIVE'],
      },
      subjectId: { in: items.map((item) => item.id) },
      subjectType,
    },
  });
  const latest = new Map<string, { action: string; reason: string }>();
  for (const decision of decisions) {
    const id = String(decision.subjectId);
    if (!latest.has(id)) {
      latest.set(id, {
        action: String(decision.action),
        reason: String(decision.reason),
      });
    }
  }
  return presentedItems.map((item) => ({
    ...(item as ContentRecord),
    decisionAction: latest.get(item.id)?.action ?? null,
    decisionReason: latest.get(item.id)?.reason ?? null,
  })) as Array<
    ContentRecord & {
      decisionAction: string | null;
      decisionReason: string | null;
    }
  >;
}

async function updateCampusWorkStatus(
  adapter: ContentAdapter,
  actor: ContentActor,
  id: string,
  currentStatus: ContentStatus | { in: ContentStatus[] },
  nextStatus: ContentStatus,
) {
  return serializableContentTransaction(adapter, async (tx) => {
    if (!tx.campusWorkPost.updateMany) throw new Error('Unsupported adapter');
    const changed = await tx.campusWorkPost.updateMany({
      data: { status: nextStatus },
      where: { authorId: actor.id, id, status: currentStatus },
    });
    if (changed.count !== 1) throw new ContentConflictError();
    return { id, status: nextStatus };
  });
}

export async function archiveOwnedContent(
  adapter: ContentAdapter,
  actor: ContentActor,
  kind: ContentKind,
  id: string,
) {
  if (kind === 'campus-work') {
    return updateCampusWorkStatus(
      adapter,
      actor,
      id,
      { in: [ContentStatus.PENDING, ContentStatus.PUBLISHED] },
      ContentStatus.ARCHIVED,
    );
  }
  const delegate = delegateFor(adapter, kind);
  if (!delegate.updateMany) throw new Error('Unsupported adapter');
  const ownerField = kind === 'marketplace' ? 'sellerId' : 'authorId';
  const changed = await delegate.updateMany({
    data: { status: ContentStatus.ARCHIVED },
    where: {
      id,
      [ownerField]: actor.id,
      status: { in: [ContentStatus.PENDING, ContentStatus.PUBLISHED] },
    },
  });
  if (changed.count !== 1) throw new ContentConflictError();
  return { id, status: ContentStatus.ARCHIVED };
}

export async function submitOwnedDraft(
  adapter: ContentAdapter,
  actor: ContentActor,
  kind: ContentKind,
  id: string,
  policy?: DocumentScanPolicy,
  publishing?: ContentPublishingPolicy,
) {
  const delegate = delegateFor(adapter, kind);
  if (!delegate.updateMany) throw new Error('Unsupported adapter');
  const ownerField = kind === 'marketplace' ? 'sellerId' : 'authorId';
  const assetInvariant =
    kind === 'resource'
      ? {
          assets: {
            ...(requireCleanDocuments(policy)
              ? {
                  none: {
                    kind: 'RESOURCE_DOCUMENT',
                    scanStatus: { not: 'CLEAN' },
                  },
                }
              : {}),
            some: {
              kind: 'RESOURCE_DOCUMENT',
              ownerId: actor.id,
              ...(requireCleanDocuments(policy) ? { scanStatus: 'CLEAN' } : {}),
              status: 'READY',
            },
          },
        }
      : kind === 'marketplace'
        ? {
            assets: {
              some: {
                kind: 'MARKETPLACE_IMAGE',
                ownerId: actor.id,
                status: 'READY',
              },
            },
          }
        : {};
  let assessment: Awaited<ReturnType<typeof prepareContentPublishing>> = null;
  if (publishing) {
    if (!isVerifiedContentActor(actor)) throw new ContentForbiddenError();
    if (!delegate.findFirst) throw new Error('Unsupported adapter');
    const tagSelect = {
      select: {
        tag: { select: { isPreset: true, label: true } },
      },
    };
    const select =
      kind === 'resource'
        ? {
            id: true,
            status: true,
            summary: true,
            tagAssignments: tagSelect,
            title: true,
          }
        : kind === 'marketplace'
          ? {
              description: true,
              id: true,
              pickupArea: true,
              status: true,
              tagAssignments: tagSelect,
              title: true,
            }
          : {
              description: true,
              id: true,
              location: true,
              payText: true,
              status: true,
              tagAssignments: tagSelect,
              title: true,
            };
    const current = await delegate.findFirst({
      select,
      where: {
        ...assetInvariant,
        id,
        [ownerField]: actor.id,
        status: ContentStatus.DRAFT,
      },
    });
    if (
      !current ||
      current.id !== id ||
      current.status !== ContentStatus.DRAFT
    ) {
      throw new ContentConflictError();
    }
    const stringField = (field: string) => {
      const value = current[field];
      if (typeof value !== 'string') throw new ContentConflictError();
      return value;
    };
    const assignments = Array.isArray(current.tagAssignments)
      ? current.tagAssignments
      : [];
    const customTags = assignments.flatMap((assignment) => {
      if (!assignment || typeof assignment !== 'object') return [];
      const tag = (assignment as { tag?: unknown }).tag;
      if (!tag || typeof tag !== 'object') return [];
      const record = tag as { isPreset?: unknown; label?: unknown };
      return record.isPreset === false && typeof record.label === 'string'
        ? [{ label: record.label }]
        : [];
    });
    const targetType =
      kind === 'resource'
        ? 'RESOURCE'
        : kind === 'marketplace'
          ? 'MARKETPLACE_ITEM'
          : 'CAMPUS_WORK';
    const content: Readonly<Record<string, string>> =
      kind === 'resource'
        ? { summary: stringField('summary'), title: stringField('title') }
        : kind === 'marketplace'
          ? {
              description: stringField('description'),
              location: stringField('pickupArea'),
              title: stringField('title'),
            }
          : {
              description: stringField('description'),
              location: stringField('location'),
              payText: stringField('payText'),
              title: stringField('title'),
            };
    assessment = await prepareContentPublishing(
      actor,
      publishing,
      (targetId) =>
        assessmentRequests(targetType, targetId, content, customTags),
      id,
    );
  }

  if (!assessment) {
    if (kind === 'campus-work') {
      return updateCampusWorkStatus(
        adapter,
        actor,
        id,
        ContentStatus.DRAFT,
        ContentStatus.PENDING,
      );
    }
    const changed = await delegate.updateMany({
      data: { status: ContentStatus.PENDING },
      where: {
        ...assetInvariant,
        id,
        [ownerField]: actor.id,
        status: ContentStatus.DRAFT,
      },
    });
    if (changed.count !== 1) throw new ContentConflictError();
    return { id, status: ContentStatus.PENDING };
  }

  const nextStatus =
    ContentStatus[publishingOutcomeStatus(assessment.prepared.outcome)];
  const result = await serializableContentTransaction(adapter, async (tx) => {
    const transactionalDelegate = delegateFor(tx, kind);
    if (!transactionalDelegate.updateMany) {
      throw new Error('Unsupported adapter');
    }
    const changed = await transactionalDelegate.updateMany({
      data: { status: nextStatus },
      where: {
        ...assetInvariant,
        id,
        [ownerField]: actor.id,
        status: ContentStatus.DRAFT,
      },
    });
    if (changed.count !== 1) throw new ContentConflictError();
    await persistPreparedAssessmentBatch(tx, assessment.prepared);
    return { id, status: nextStatus };
  });
  throwProviderBlock(assessment.prepared);
  return result;
}

export async function editOwnedContent(
  adapter: ContentAdapter,
  actor: ContentActor,
  kind: ContentKind,
  id: string,
  input: UpdateContentInput,
) {
  const delegate = delegateFor(adapter, kind);
  if (!delegate.updateMany) throw new Error('Unsupported adapter');
  const ownerField = kind === 'marketplace' ? 'sellerId' : 'authorId';
  if (!isVerifiedContentActor(actor)) {
    throw new ContentForbiddenError();
  }
  if (!('customTags' in input) || !('presetTagIds' in input)) {
    throw new ContentConflictError();
  }
  const { customTags, presetTagIds } = input;
  const scope =
    kind === 'resource'
      ? 'RESOURCE'
      : kind === 'marketplace'
        ? 'MARKETPLACE'
        : 'CAMPUS_WORK';
  const updateData =
    kind === 'resource'
      ? 'summary' in input
        ? {
            status: ContentStatus.DRAFT,
            summary: input.summary,
            title: input.title,
          }
        : null
      : kind === 'marketplace' && 'condition' in input
        ? {
            condition: input.condition,
            contact: input.contact,
            description: input.description,
            pickupArea: input.pickupArea,
            priceCents: input.priceCents,
            status: ContentStatus.DRAFT,
            title: input.title,
          }
        : kind === 'campus-work' && 'location' in input && 'contact' in input
          ? {
              contact: input.contact,
              description: input.description,
              location: input.location,
              payText: input.payText,
              status: ContentStatus.DRAFT,
              title: input.title,
            }
          : null;
  if (!updateData) throw new ContentConflictError();
  const preparedTags = await prepareContentTagSelection(actor, scope, {
    customTags,
    presetTagIds,
  });
  return serializableContentTransaction(adapter, async (tx) => {
    const transactionalDelegate = delegateFor(tx, kind);
    if (!transactionalDelegate.updateMany)
      throw new Error('Unsupported adapter');
    const changed = await transactionalDelegate.updateMany({
      data: updateData,
      where: {
        id,
        [ownerField]: actor.id,
        status: { in: [ContentStatus.DRAFT, ContentStatus.REJECTED] },
      },
    });
    if (changed.count !== 1) throw new ContentConflictError();
    const resolvedTagIds = await resolveContentTagsInTransaction(
      tx,
      preparedTags,
    );
    await writeResolvedTagJoins(tx, actor, kind, id, resolvedTagIds, true);
    return { id, status: ContentStatus.DRAFT };
  });
}

export async function getOwnedContent(
  adapter: ContentAdapter,
  actor: ContentActor,
  kind: ContentKind,
  id: string,
) {
  const delegate = delegateFor(adapter, kind);
  if (!delegate.findFirst) throw new Error('Unsupported adapter');
  const ownerField = kind === 'marketplace' ? 'sellerId' : 'authorId';
  const item = await delegate.findFirst({
    select: {
      ...publicSelect(kind),
      ...(kind === 'marketplace' || kind === 'campus-work'
        ? { contact: true }
        : {}),
    },
    where: { id, [ownerField]: actor.id },
  });
  return item ? presentContentRecord(item) : null;
}

export async function authorizeAssetRead(
  adapter: ContentAdapter,
  actor: ContentActor | null,
  assetId: string,
  policy?: DocumentScanPolicy,
) {
  if (!adapter.asset.findFirst) throw new Error('Unsupported adapter');
  const asset = await adapter.asset.findFirst({
    select: {
      announcement: {
        select: {
          campus: { select: { isActive: true, slug: true } },
          campusId: true,
          id: true,
        },
      },
      contentType: true,
      kind: true,
      marketplaceItem: { select: { status: true } },
      ownerId: true,
      resource: { select: { status: true } },
      scanStatus: true,
      status: true,
      storageKey: true,
    },
    where: { id: assetId },
  });
  if (!asset || asset.status !== 'READY') throw new ContentForbiddenError();
  if (
    requireCleanDocuments(policy) &&
    asset.kind === 'RESOURCE_DOCUMENT' &&
    asset.scanStatus !== 'CLEAN'
  ) {
    throw new ContentForbiddenError();
  }
  const announcement = asset.announcement as
    | {
        campus?: { isActive?: unknown; slug?: unknown };
        campusId?: unknown;
        id?: unknown;
      }
    | null
    | undefined;
  if (asset.kind === 'ANNOUNCEMENT_IMAGE') {
    if (!announcement?.id) throw new ContentForbiddenError();
    if (actor) {
      if (announcement.campusId !== actor.campusId) {
        throw new ContentForbiddenError();
      }
    } else if (
      announcement.campus?.isActive !== true ||
      announcement.campus.slug !== getDefaultCampusSlug()
    ) {
      throw new ContentForbiddenError();
    }
    return {
      contentType: String(asset.contentType),
      kind: String(asset.kind),
      storageKey: String(asset.storageKey),
    };
  }
  const resource = asset.resource as { status?: unknown } | null;
  const marketplaceItem = asset.marketplaceItem as { status?: unknown } | null;
  const published =
    resource?.status === ContentStatus.PUBLISHED ||
    marketplaceItem?.status === ContentStatus.PUBLISHED;
  const privileged = actor?.role === 'MODERATOR' || actor?.role === 'ADMIN';
  const displayImage =
    asset.kind === 'RESOURCE_IMAGE' || asset.kind === 'MARKETPLACE_IMAGE';
  if (!actor) {
    if (published && displayImage) {
      return {
        contentType: String(asset.contentType),
        kind: String(asset.kind),
        storageKey: String(asset.storageKey),
      };
    }
    throw new ContentAuthenticationRequiredError();
  }
  if (!published && !privileged && asset.ownerId !== actor?.id) {
    throw new ContentForbiddenError();
  }
  return {
    contentType: String(asset.contentType),
    kind: String(asset.kind),
    storageKey: String(asset.storageKey),
  };
}
