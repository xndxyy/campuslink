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
  findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
}

interface FavouriteRecord {
  createdAt: Date;
  id: string;
  targetId: string;
  targetType: FavouriteTargetType;
}

interface FavouriteIdentity {
  id: string;
}

export interface FavouritesAdapter {
  $transaction<T>(operation: (tx: FavouritesAdapter) => Promise<T>): Promise<T>;
  favourite: {
    deleteMany(args: Record<string, unknown>): Promise<{ count: number }>;
    findMany(args: Record<string, unknown>): Promise<FavouriteRecord[]>;
    findUnique(
      args: Record<string, unknown>,
    ): Promise<FavouriteIdentity | null>;
    upsert(args: Record<string, unknown>): Promise<FavouriteIdentity>;
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

function targetKey(targetType: FavouriteTargetType, targetId: string) {
  return `${targetType}:${targetId}`;
}

async function findVisibleTargets(
  adapter: FavouritesAdapter,
  actor: FavouriteActor,
  records: FavouriteRecord[],
) {
  const idsByType = new Map<FavouriteTargetType, Set<string>>();
  for (const record of records) {
    const ids = idsByType.get(record.targetType) ?? new Set<string>();
    ids.add(record.targetId);
    idsByType.set(record.targetType, ids);
  }

  const visible = new Map<string, Record<string, unknown>>();
  await Promise.all(
    [...idsByType].map(async ([targetType, ids]) => {
      const items = await delegateFor(adapter, targetType).findMany({
        select: publicSelect(targetType),
        where: {
          campusId: actor.campusId,
          id: { in: [...ids] },
          status: 'PUBLISHED',
        },
      });
      for (const item of items) {
        if (typeof item.id === 'string') {
          visible.set(targetKey(targetType, item.id), item);
        }
      }
    }),
  );
  return visible;
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
  const batchSize = 50;
  let cursor: Pick<FavouriteRecord, 'createdAt' | 'id'> | undefined;

  while (visible.length < needed) {
    const records = await adapter.favourite.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: batchSize,
      where: {
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
        userId: actor.id,
      },
    });
    if (records.length === 0) break;
    const last = records.at(-1)!;
    cursor = { createdAt: last.createdAt, id: last.id };

    const visibleTargets = await findVisibleTargets(adapter, actor, records);
    const staleIds: string[] = [];
    for (const record of records) {
      const target = {
        targetId: record.targetId,
        targetType: record.targetType,
      };
      const item = visibleTargets.get(
        targetKey(record.targetType, record.targetId),
      );
      if (item)
        visible.push({ ...target, favouritedAt: record.createdAt, item });
      else staleIds.push(record.id);
    }
    if (staleIds.length) {
      await adapter.favourite.deleteMany({
        where: { id: { in: staleIds }, userId: actor.id },
      });
    }
    if (records.length < batchSize) break;
  }
  const offset = (page - 1) * pageSize;
  return {
    hasNext: visible.length > offset + pageSize,
    items: visible.slice(offset, offset + pageSize),
    page,
    pageSize,
  };
}
