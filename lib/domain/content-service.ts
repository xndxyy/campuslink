import { ContentStatus } from './content-status';
import type {
  ContentListQuery,
  CreateJobInput,
  CreateMarketplaceItemInput,
  CreateResourceInput,
  UpdateJobInput,
  UpdateMarketplaceItemInput,
  UpdateResourceInput,
} from '@/lib/validation/content';

type Role = 'STUDENT' | 'MODERATOR' | 'ADMIN';
export type ContentKind = 'resource' | 'marketplace' | 'job';
export type UpdateContentInput =
  UpdateResourceInput | UpdateMarketplaceItemInput | UpdateJobInput;

export interface ContentActor {
  campusId: string;
  id: string;
  role: Role;
}

interface AssetRecord {
  id: string;
  kind: 'RESOURCE_DOCUMENT' | 'RESOURCE_IMAGE' | 'MARKETPLACE_IMAGE';
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

export interface ContentAdapter {
  $transaction<T>(operation: (tx: ContentAdapter) => Promise<T>): Promise<T>;
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
  jobPost: Delegate;
  marketplaceItem: Delegate;
  moderationAction?: {
    findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
  resource: Delegate;
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

function delegateFor(adapter: ContentAdapter, kind: ContentKind): Delegate {
  return kind === 'resource'
    ? adapter.resource
    : kind === 'marketplace'
      ? adapter.marketplaceItem
      : adapter.jobPost;
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

export async function createResource(
  adapter: ContentAdapter,
  actor: ContentActor,
  input: CreateResourceInput,
  policy?: DocumentScanPolicy,
) {
  return adapter.$transaction(async (tx) => {
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
        courseCode: input.courseCode,
        status: ContentStatus.DRAFT,
        summary: input.summary,
        tags: input.tags,
        title: input.title,
      },
    });
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
    return tx.resource.update({
      data: { status: ContentStatus.PENDING },
      where: { id: created.id },
    });
  });
}

export async function createMarketplaceItem(
  adapter: ContentAdapter,
  actor: ContentActor,
  input: CreateMarketplaceItemInput,
) {
  return adapter.$transaction(async (tx) => {
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
        pickupArea: input.pickupArea,
        priceCents: input.priceCents,
        sellerId: actor.id,
        status: ContentStatus.DRAFT,
        title: input.title,
      },
    });
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
    return tx.marketplaceItem.update({
      data: { status: ContentStatus.PENDING },
      where: { id: created.id },
    });
  });
}

export async function createJobPost(
  adapter: ContentAdapter,
  actor: ContentActor,
  input: CreateJobInput,
) {
  return adapter.$transaction(async (tx) => {
    const created = await tx.jobPost.create({
      data: {
        authorId: actor.id,
        campusId: actor.campusId,
        ...input,
        status: ContentStatus.DRAFT,
      },
    });
    return tx.jobPost.update({
      data: { status: ContentStatus.PENDING },
      where: { id: created.id },
    });
  });
}

function publicWhere(
  kind: ContentKind,
  query: Partial<ContentListQuery> & { campusId?: string },
) {
  const searchableFields =
    kind === 'resource'
      ? ['title', 'summary', 'courseCode']
      : kind === 'marketplace'
        ? ['title', 'description', 'pickupArea']
        : ['title', 'company', 'description', 'location'];
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
    campusId: query.campusId,
    status: ContentStatus.PUBLISHED,
    ...search,
    ...(kind === 'resource' && query.courseCode
      ? { courseCode: query.courseCode }
      : {}),
    ...(kind === 'resource' && query.tag ? { tags: { has: query.tag } } : {}),
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
    ...(kind === 'job' && query.company
      ? { company: { contains: query.company, mode: 'insensitive' } }
      : {}),
    ...(kind === 'job' && query.location
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
      courseCode: true,
      summary: true,
      tags: true,
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
      // Contact is deliberately absent until the audited request-contact flow.
    };
  }
  return {
    ...shared,
    company: true,
    description: true,
    location: true,
    payText: true,
    author: { select: { name: true } },
  };
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
  return { items, page, pageSize, total };
}

export async function getPublicContent(
  adapter: ContentAdapter,
  kind: ContentKind,
  id: string,
) {
  const delegate = delegateFor(adapter, kind);
  if (!delegate.findFirst) throw new Error('Unsupported adapter');
  return delegate.findFirst({
    select: publicSelect(kind),
    where: { id, status: ContentStatus.PUBLISHED },
  });
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
    where: { [ownerField]: actor.id },
  });
  if (!adapter.moderationAction || items.length === 0) {
    return items.map((item) => ({
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
  return items.map((item) => ({
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

export async function archiveOwnedContent(
  adapter: ContentAdapter,
  actor: ContentActor,
  kind: ContentKind,
  id: string,
) {
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
  const changed = await delegate.updateMany({
    data: { ...input, status: ContentStatus.DRAFT },
    where: {
      id,
      [ownerField]: actor.id,
      status: { in: [ContentStatus.DRAFT, ContentStatus.REJECTED] },
    },
  });
  if (changed.count !== 1) throw new ContentConflictError();
  return { id, status: ContentStatus.DRAFT };
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
  return delegate.findFirst({
    select: {
      ...publicSelect(kind),
      ...(kind === 'marketplace' ? { contact: true } : {}),
    },
    where: { id, [ownerField]: actor.id },
  });
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
