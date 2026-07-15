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
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $transaction<T>(operation: (tx: FavouritesAdapter) => Promise<T>): Promise<T>;
  favourite: {
    deleteMany(args: Record<string, unknown>): Promise<{ count: number }>;
    findMany(args: Record<string, unknown>): Promise<FavouriteRecord[]>;
    findUnique(
      args: Record<string, unknown>,
    ): Promise<FavouriteIdentity | null>;
    upsert(args: Record<string, unknown>): Promise<FavouriteIdentity>;
  };
  campusWorkPost: TargetDelegate;
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
      : adapter.campusWorkPost;
}

function publicSelect(targetType: FavouriteTargetType) {
  const shared = { createdAt: true, id: true, title: true };
  if (targetType === 'RESOURCE') {
    return {
      ...shared,
      author: { select: { name: true } },
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

const maxFavouritesPage = 50;

interface VisibleFavouriteRow {
  favouritedAt: Date;
  favouriteId: string;
  item: Record<string, unknown>;
  targetId: string;
  targetType: FavouriteTargetType;
}

function isFavouriteTargetType(value: unknown): value is FavouriteTargetType {
  return (
    value === 'RESOURCE' || value === 'MARKETPLACE_ITEM' || value === 'JOB_POST'
  );
}

function isVisibleFavouriteRow(value: unknown): value is VisibleFavouriteRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<VisibleFavouriteRow>;
  return (
    row.favouritedAt instanceof Date &&
    typeof row.favouriteId === 'string' &&
    typeof row.targetId === 'string' &&
    isFavouriteTargetType(row.targetType) &&
    Boolean(row.item) &&
    typeof row.item === 'object' &&
    !Array.isArray(row.item)
  );
}

export async function listUserFavourites(
  adapter: FavouritesAdapter,
  actor: FavouriteActor,
  query: { page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, Math.min(query.page ?? 1, maxFavouritesPage));
  const pageSize = Math.max(1, Math.min(query.pageSize ?? 12, 50));
  const take = pageSize + 1;
  const offset = (page - 1) * pageSize;
  const rows = await adapter.$queryRaw<unknown[]>`
    SELECT visible."favouriteId", visible."favouritedAt", visible."targetId",
           visible."targetType", visible.item
    FROM (
      SELECT f.id AS "favouriteId", f."createdAt" AS "favouritedAt",
             f."targetId", 'RESOURCE'::text AS "targetType",
             jsonb_build_object(
               'id', r.id, 'title', r.title, 'createdAt', r."createdAt",
               'summary', r.summary, 'tags', r.tags,
               'author', jsonb_build_object('name', author.name)
             ) AS item
      FROM "Favourite" f
      JOIN "Resource" r
        ON f."targetType" = 'RESOURCE' AND r.id = f."targetId"
      JOIN "User" author ON author.id = r."authorId"
      WHERE f."userId" = ${actor.id}
        AND r."campusId" = ${actor.campusId}
        AND r.status = 'PUBLISHED'

      UNION ALL

      SELECT f.id AS "favouriteId", f."createdAt" AS "favouritedAt",
             f."targetId", 'MARKETPLACE_ITEM'::text AS "targetType",
             jsonb_build_object(
               'id', m.id, 'title', m.title, 'createdAt', m."createdAt",
               'description', m.description, 'condition', m.condition,
               'pickupArea', m."pickupArea", 'priceCents', m."priceCents",
               'seller', jsonb_build_object('name', seller.name)
             ) AS item
      FROM "Favourite" f
      JOIN "MarketplaceItem" m
        ON f."targetType" = 'MARKETPLACE_ITEM' AND m.id = f."targetId"
      JOIN "User" seller ON seller.id = m."sellerId"
      WHERE f."userId" = ${actor.id}
        AND m."campusId" = ${actor.campusId}
        AND m.status = 'PUBLISHED'

      UNION ALL

      SELECT f.id AS "favouriteId", f."createdAt" AS "favouritedAt",
             f."targetId", 'JOB_POST'::text AS "targetType",
             jsonb_build_object(
               'id', j.id, 'title', j.title, 'createdAt', j."createdAt",
               'description', j.description, 'location', j.location,
               'payText', j."payText",
               'author', jsonb_build_object('name', author.name)
             ) AS item
      FROM "Favourite" f
      JOIN "CampusWorkPost" j
        ON f."targetType" = 'JOB_POST' AND j.id = f."targetId"
      JOIN "User" author ON author.id = j."authorId"
      WHERE f."userId" = ${actor.id}
        AND j."campusId" = ${actor.campusId}
        AND j.status = 'PUBLISHED'
    ) visible
    ORDER BY visible."favouritedAt" DESC, visible."favouriteId" DESC
    LIMIT ${take} OFFSET ${offset}
  `;
  const visible = rows.filter(isVisibleFavouriteRow);
  return {
    hasNext: page < maxFavouritesPage && visible.length > pageSize,
    items: visible.slice(0, pageSize).map((row) => ({
      favouritedAt: row.favouritedAt,
      item: row.item,
      targetId: row.targetId,
      targetType: row.targetType,
    })),
    page,
    pageSize,
  };
}
