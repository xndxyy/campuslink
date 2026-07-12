export type FavouriteTargetType = 'RESOURCE' | 'MARKETPLACE_ITEM' | 'JOB_POST';

export interface FavouriteActor {
  campusId: string;
  id: string;
}

export interface FavouriteTarget {
  targetId: string;
  targetType: FavouriteTargetType;
}

interface TargetDelegate {
  findFirst(
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
}

interface FavouriteRecord {
  createdAt?: Date;
  id: string;
  targetId?: string;
  targetType?: FavouriteTargetType;
}

export interface FavouritesAdapter {
  $transaction<T>(operation: (tx: FavouritesAdapter) => Promise<T>): Promise<T>;
  favourite: {
    deleteMany(args: Record<string, unknown>): Promise<{ count: number }>;
    findMany(args: Record<string, unknown>): Promise<FavouriteRecord[]>;
    findUnique(args: Record<string, unknown>): Promise<FavouriteRecord | null>;
    upsert(args: Record<string, unknown>): Promise<FavouriteRecord>;
  };
  jobPost: TargetDelegate;
  marketplaceItem: TargetDelegate;
  resource: TargetDelegate;
}

export class FavouriteNotFoundError extends Error {
  constructor() {
    super('Published content was not found');
  }
}

function delegateFor(
  adapter: FavouritesAdapter,
  targetType: FavouriteTargetType,
) {
  return targetType === 'RESOURCE'
    ? adapter.resource
    : targetType === 'MARKETPLACE_ITEM'
      ? adapter.marketplaceItem
      : adapter.jobPost;
}

function publicSelect(targetType: FavouriteTargetType) {
  const shared = { createdAt: true, id: true, title: true };
  if (targetType === 'RESOURCE') {
    return {
      ...shared,
      author: { select: { name: true } },
      courseCode: true,
      summary: true,
      tags: true,
    };
  }
  if (targetType === 'MARKETPLACE_ITEM') {
    return {
      ...shared,
      condition: true,
      description: true,
      pickupArea: true,
      priceCents: true,
      seller: { select: { name: true } },
      // Never select contact in a favourite list or card.
    };
  }
  return {
    ...shared,
    author: { select: { name: true } },
    company: true,
    description: true,
    location: true,
    payText: true,
  };
}

async function findVisibleTarget(
  adapter: FavouritesAdapter,
  actor: FavouriteActor,
  target: FavouriteTarget,
) {
  return delegateFor(adapter, target.targetType).findFirst({
    select: publicSelect(target.targetType),
    where: {
      campusId: actor.campusId,
      id: target.targetId,
      status: 'PUBLISHED',
    },
  });
}

function composite(actor: FavouriteActor, target: FavouriteTarget) {
  return {
    targetId: target.targetId,
    targetType: target.targetType,
    userId: actor.id,
  };
}

export async function addFavourite(
  adapter: FavouritesAdapter,
  actor: FavouriteActor,
  target: FavouriteTarget,
) {
  return adapter.$transaction(async (tx) => {
    if (!(await findVisibleTarget(tx, actor, target))) {
      throw new FavouriteNotFoundError();
    }
    await tx.favourite.upsert({
      create: composite(actor, target),
      update: {},
      where: { userId_targetType_targetId: composite(actor, target) },
    });
    return { favourited: true };
  });
}

export async function removeFavourite(
  adapter: FavouritesAdapter,
  actor: FavouriteActor,
  target: FavouriteTarget,
) {
  await adapter.favourite.deleteMany({ where: composite(actor, target) });
  return { favourited: false };
}

export async function toggleFavourite(
  adapter: FavouritesAdapter,
  actor: FavouriteActor,
  target: FavouriteTarget,
) {
  return adapter.$transaction(async (tx) => {
    const where = composite(actor, target);
    const existing = await tx.favourite.findUnique({
      where: { userId_targetType_targetId: where },
    });
    if (existing) {
      await tx.favourite.deleteMany({ where });
      return { favourited: false };
    }
    if (!(await findVisibleTarget(tx, actor, target))) {
      throw new FavouriteNotFoundError();
    }
    await tx.favourite.upsert({
      create: where,
      update: {},
      where: { userId_targetType_targetId: where },
    });
    return { favourited: true };
  });
}

export async function hasFavourite(
  adapter: FavouritesAdapter,
  actor: FavouriteActor,
  target: FavouriteTarget,
) {
  const existing = await adapter.favourite.findUnique({
    where: { userId_targetType_targetId: composite(actor, target) },
  });
  if (!existing) return false;
  if (await findVisibleTarget(adapter, actor, target)) return true;
  await adapter.favourite.deleteMany({ where: composite(actor, target) });
  return false;
}

export interface FavouriteCard extends FavouriteTarget {
  favouritedAt: Date;
  item: Record<string, unknown>;
}

export async function listUserFavourites(
  adapter: FavouritesAdapter,
  actor: FavouriteActor,
  query: { page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, Math.min(query.page ?? 1, 50));
  const pageSize = Math.max(1, Math.min(query.pageSize ?? 12, 50));
  const needed = page * pageSize + 1;
  const visible: FavouriteCard[] = [];
  const staleIds: string[] = [];
  const batchSize = 50;
  let skip = 0;

  // Scan in the unique stable order, filtering polymorphic targets that have
  // since been hidden/deleted. The cap prevents unbounded cleanup work.
  while (visible.length < needed && skip < 500) {
    const records = await adapter.favourite.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: batchSize,
      where: { userId: actor.id },
    });
    for (const record of records) {
      if (!record.targetId || !record.targetType || !record.createdAt) continue;
      const target = {
        targetId: record.targetId,
        targetType: record.targetType,
      };
      const item = await findVisibleTarget(adapter, actor, target);
      if (item)
        visible.push({ ...target, favouritedAt: record.createdAt, item });
      else staleIds.push(record.id);
      if (visible.length >= needed) break;
    }
    skip += records.length;
    if (records.length < batchSize) break;
  }
  if (staleIds.length) {
    await adapter.favourite.deleteMany({
      where: { id: { in: staleIds }, userId: actor.id },
    });
  }
  const offset = (page - 1) * pageSize;
  return {
    hasNext: visible.length > offset + pageSize,
    items: visible.slice(offset, offset + pageSize),
    page,
    pageSize,
  };
}
