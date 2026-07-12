import { ContentStatus, transitionContentStatus } from './content-status';
import type {
  ContentListQuery,
  CreateJobInput,
  CreateMarketplaceItemInput,
  CreateResourceInput,
} from '@/lib/validation/content';

type Role = 'STUDENT' | 'MODERATOR' | 'ADMIN';
type ContentKind = 'resource' | 'marketplace' | 'job';

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
  status: string;
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
}

export interface ContentAdapter {
  $transaction<T>(operation: (tx: ContentAdapter) => Promise<T>): Promise<T>;
  asset: {
    findMany(args: { where: { id: { in: string[] } } }): Promise<AssetRecord[]>;
    updateMany(args: {
      data: { marketplaceItemId?: string; resourceId?: string };
      where: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  jobPost: Delegate;
  marketplaceItem: Delegate;
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
}

export async function createResource(
  adapter: ContentAdapter,
  actor: ContentActor,
  input: CreateResourceInput,
) {
  return adapter.$transaction(async (tx) => {
    const assets = await tx.asset.findMany({
      where: { id: { in: input.assetIds } },
    });
    validateAssets(assets, input.assetIds, actor, [
      'RESOURCE_DOCUMENT',
      'RESOURCE_IMAGE',
    ]);
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
        marketplaceItemId: null,
        resourceId: null,
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
        marketplaceItemId: null,
        resourceId: null,
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
  const search = query.search
    ? {
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          {
            [kind === 'resource' ? 'summary' : 'description']: {
              contains: query.search,
              mode: 'insensitive',
            },
          },
        ],
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
      assets: { select: { id: true, kind: true } },
      courseCode: true,
      summary: true,
      tags: true,
    };
  }
  if (kind === 'marketplace') {
    return {
      ...shared,
      assets: { select: { id: true, kind: true } },
      condition: true,
      description: true,
      pickupArea: true,
      priceCents: true,
      // Contact is deliberately absent until the audited request-contact flow.
    };
  }
  return {
    ...shared,
    company: true,
    description: true,
    location: true,
    payText: true,
  };
}

export async function listPublicContent(
  adapter: ContentAdapter,
  kind: ContentKind,
  query: Partial<ContentListQuery> & { campusId?: string },
) {
  const page = Math.min(Math.max(query.page ?? 1, 1), 10_000);
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
) {
  const delegate = delegateFor(adapter, kind);
  if (!delegate.findMany) throw new Error('Unsupported adapter');
  const ownerField = kind === 'marketplace' ? 'sellerId' : 'authorId';
  return delegate.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    where: { [ownerField]: actor.id },
  });
}

export async function archiveOwnedContent(
  adapter: ContentAdapter,
  actor: ContentActor,
  kind: ContentKind,
  id: string,
) {
  const delegate = delegateFor(adapter, kind);
  if (!delegate.findFirst) throw new Error('Unsupported adapter');
  const ownerField = kind === 'marketplace' ? 'sellerId' : 'authorId';
  const current = await delegate.findFirst({
    where: { id, [ownerField]: actor.id },
  });
  if (!current) throw new ContentNotFoundError();
  const currentStatus = current.status as ContentStatus;
  if (
    ![ContentStatus.PENDING, ContentStatus.PUBLISHED].includes(currentStatus)
  ) {
    throw new ContentConflictError();
  }
  transitionContentStatus(currentStatus, ContentStatus.ARCHIVED);
  return delegate.update({
    data: { status: ContentStatus.ARCHIVED },
    where: { id },
  });
}

export async function returnRejectedToDraft(
  adapter: ContentAdapter,
  actor: ContentActor,
  kind: ContentKind,
  id: string,
) {
  const delegate = delegateFor(adapter, kind);
  if (!delegate.findFirst) throw new Error('Unsupported adapter');
  const ownerField = kind === 'marketplace' ? 'sellerId' : 'authorId';
  const current = await delegate.findFirst({
    where: { id, [ownerField]: actor.id },
  });
  if (!current) throw new ContentNotFoundError();
  transitionContentStatus(current.status as ContentStatus, ContentStatus.DRAFT);
  return delegate.update({
    data: { status: ContentStatus.DRAFT },
    where: { id },
  });
}

export async function submitOwnedDraft(
  adapter: ContentAdapter,
  actor: ContentActor,
  kind: ContentKind,
  id: string,
) {
  const delegate = delegateFor(adapter, kind);
  if (!delegate.findFirst) throw new Error('Unsupported adapter');
  const ownerField = kind === 'marketplace' ? 'sellerId' : 'authorId';
  const current = await delegate.findFirst({
    where: { id, [ownerField]: actor.id },
  });
  if (!current) throw new ContentNotFoundError();
  transitionContentStatus(
    current.status as ContentStatus,
    ContentStatus.PENDING,
  );
  return delegate.update({
    data: { status: ContentStatus.PENDING },
    where: { id },
  });
}
