import { describe, expect, it, vi } from 'vitest';

import {
  addFavourite,
  FavouriteNotFoundError,
  hasFavourite,
  listUserFavourites,
  removeFavourite,
  toggleFavourite,
  type FavouritesAdapter,
} from '@/lib/domain/favourites';

const actor = { campusId: 'campus_1', id: 'user_1' };
const target = { targetId: 'resource_1', targetType: 'RESOURCE' as const };

function adapter(overrides: Record<string, unknown> = {}) {
  const value = {
    $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation(value),
    ),
    favourite: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({ id: 'favourite_1' })),
    },
    jobPost: { findFirst: vi.fn(async () => null) },
    marketplaceItem: { findFirst: vi.fn(async () => null) },
    resource: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => ({
        author: { name: 'Ada' },
        courseCode: 'CS101',
        createdAt: new Date('2026-07-12T10:00:00Z'),
        id: target.targetId,
        summary: 'Safe summary',
        tags: ['algorithms'],
        title: 'Algorithms',
      })),
    },
    ...overrides,
  };
  return value as unknown as FavouritesAdapter;
}

function paginatedAdapter({
  leadingStale = 0,
  total,
}: {
  leadingStale?: number;
  total: number;
}) {
  const createdAt = new Date('2026-07-12T12:00:00Z');
  const records = Array.from({ length: total }, (_, index) => ({
    createdAt,
    id: `fav_${String(total - index).padStart(4, '0')}`,
    targetId: `resource_${String(index).padStart(4, '0')}`,
    targetType: 'RESOURCE' as const,
  }));
  const visibleIds = new Set(
    records.slice(leadingStale).map((record) => record.targetId),
  );
  const target = (id: string) =>
    visibleIds.has(id)
      ? {
          author: { name: 'Ada' },
          courseCode: 'CS101',
          createdAt,
          id,
          summary: `Summary for ${id}`,
          tags: ['algorithms'],
          title: `Title for ${id}`,
        }
      : null;
  const findMany = vi.fn(async (args: Record<string, unknown>) => {
    const where = args.where as {
      OR?: Array<{
        createdAt?: Date | { lt: Date };
        id?: { lt: string };
      }>;
    };
    let start = Number(args.skip ?? 0);
    const boundary = where.OR?.[1];
    const boundaryId = boundary?.id?.lt;
    if (boundaryId) {
      const boundaryIndex = records.findIndex(
        (record) => record.id === boundaryId,
      );
      start = boundaryIndex === -1 ? records.length : boundaryIndex + 1;
    }
    return records.slice(start, start + Number(args.take));
  });
  const resourceFindMany = vi.fn(async (args: Record<string, unknown>) => {
    const ids = (args.where as { id: { in: string[] } }).id.in;
    return ids.map(target).filter((item) => item !== null);
  });
  const db = adapter({
    favourite: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findMany,
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({ id: 'favourite_1' })),
    },
    resource: {
      findFirst: vi.fn(async (args: Record<string, unknown>) => {
        const id = (args.where as { id: string }).id;
        return target(id);
      }),
      findMany: resourceFindMany,
    },
  });
  return { db, findMany, records, resourceFindMany };
}

describe('favourites domain', () => {
  it('adds an existing published same-campus target idempotently', async () => {
    const db = adapter();
    await addFavourite(db, actor, target);
    await addFavourite(db, actor, target);

    expect(db.favourite.upsert).toHaveBeenCalledTimes(2);
    expect(db.favourite.upsert).toHaveBeenCalledWith({
      create: { ...target, userId: actor.id },
      update: {},
      where: {
        userId_targetType_targetId: { ...target, userId: actor.id },
      },
    });
  });

  it('denies a hidden or cross-campus target', async () => {
    const db = adapter({
      resource: { findFirst: vi.fn(async () => null) },
    });
    await expect(addFavourite(db, actor, target)).rejects.toBeInstanceOf(
      FavouriteNotFoundError,
    );
    expect(db.favourite.upsert).not.toHaveBeenCalled();
  });

  it('removes a favourite idempotently', async () => {
    const db = adapter();
    await removeFavourite(db, actor, target);
    await removeFavourite(db, actor, target);
    expect(db.favourite.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('toggles an existing favourite off and a missing favourite on', async () => {
    const existing = adapter();
    vi.mocked(existing.favourite.findUnique).mockResolvedValueOnce({
      id: 'favourite_1',
    });
    await expect(toggleFavourite(existing, actor, target)).resolves.toEqual({
      favourited: false,
    });

    const missing = adapter();
    await expect(toggleFavourite(missing, actor, target)).resolves.toEqual({
      favourited: true,
    });
  });

  it('hasFavourite returns false when the target is no longer visible', async () => {
    const db = adapter({
      resource: { findFirst: vi.fn(async () => null) },
    });
    vi.mocked(db.favourite.findUnique).mockResolvedValue({ id: 'favourite_1' });
    await expect(hasFavourite(db, actor, target)).resolves.toBe(false);
    expect(db.favourite.deleteMany).toHaveBeenCalled();
  });

  it('filters and cleans stale favourites while preserving stable order', async () => {
    const db = adapter();
    vi.mocked(db.favourite.findMany).mockResolvedValueOnce([
      {
        createdAt: new Date('2026-07-12T12:00:00Z'),
        id: 'fav_hidden',
        targetId: 'hidden',
        targetType: 'RESOURCE',
      },
      {
        createdAt: new Date('2026-07-12T11:00:00Z'),
        id: 'fav_visible',
        targetId: 'resource_1',
        targetType: 'RESOURCE',
      },
    ]);
    vi.mocked(db.resource.findMany).mockResolvedValueOnce([
      {
        author: { name: 'Ada' },
        courseCode: 'CS101',
        createdAt: new Date('2026-07-12T10:00:00Z'),
        id: 'resource_1',
        summary: 'Safe summary',
        tags: ['algorithms'],
        title: 'Algorithms',
      },
    ]);

    const result = await listUserFavourites(db, actor, {
      page: 1,
      pageSize: 10,
    });
    expect(result.items.map((item) => item.targetId)).toEqual(['resource_1']);
    expect(result.items[0]).not.toHaveProperty('contact');
    expect(db.favourite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(db.favourite.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['fav_hidden'] }, userId: actor.id },
    });
  });

  it('reaches pages beyond 500 visible favourites without an arbitrary scan cap', async () => {
    const { db, records } = paginatedAdapter({ total: 551 });

    const result = await listUserFavourites(db, actor, {
      page: 11,
      pageSize: 50,
    });

    expect(result.items).toHaveLength(50);
    expect(result.items[0]?.targetId).toBe(records[500]?.targetId);
    expect(result.items[49]?.targetId).toBe(records[549]?.targetId);
    expect(result.hasNext).toBe(true);
  });

  it('stops at page 50 without hiding the previous page next link', async () => {
    const page50Source = paginatedAdapter({ total: 2502 });
    const page50 = await listUserFavourites(page50Source.db, actor, {
      page: 50,
      pageSize: 50,
    });

    expect(page50.items).toHaveLength(50);
    expect(page50.items[0]?.targetId).toBe(
      page50Source.records[2450]?.targetId,
    );
    expect(page50.items[49]?.targetId).toBe(
      page50Source.records[2499]?.targetId,
    );
    expect(page50.page).toBe(50);
    expect(page50.hasNext).toBe(false);

    const page49Source = paginatedAdapter({ total: 2502 });
    const page49 = await listUserFavourites(page49Source.db, actor, {
      page: 49,
      pageSize: 50,
    });
    expect(page49.page).toBe(49);
    expect(page49.hasNext).toBe(true);
  });

  it('advances beyond more than 500 leading stale favourites', async () => {
    const { db, records, resourceFindMany } = paginatedAdapter({
      leadingStale: 525,
      total: 528,
    });

    const result = await listUserFavourites(db, actor, {
      page: 1,
      pageSize: 2,
    });

    expect(result.items.map((item) => item.targetId)).toEqual([
      records[525]?.targetId,
      records[526]?.targetId,
    ]);
    expect(result.hasNext).toBe(true);
    expect(resourceFindMany).toHaveBeenCalled();
    expect(resourceFindMany.mock.calls.length).toBeLessThanOrEqual(11);
    for (const [call] of resourceFindMany.mock.calls) {
      const where = (
        call as {
          where: {
            campusId: string;
            id: { in: string[] };
            status: string;
          };
        }
      ).where;
      expect(where.campusId).toBe(actor.campusId);
      expect(where.status).toBe('PUBLISHED');
      expect(where.id.in.length).toBeLessThanOrEqual(50);
    }
    expect(db.favourite.deleteMany).toHaveBeenCalled();
    for (const [call] of vi.mocked(db.favourite.deleteMany).mock.calls) {
      const ids = (call as { where: { id: { in: string[] }; userId: string } })
        .where.id.in;
      expect(ids.length).toBeLessThanOrEqual(50);
    }
  });

  it('terminates after exhausting an all-stale source while its cursor advances', async () => {
    const { db, findMany } = paginatedAdapter({
      leadingStale: 620,
      total: 620,
    });

    const result = await listUserFavourites(db, actor, {
      page: 1,
      pageSize: 12,
    });

    expect(result).toEqual({
      hasNext: false,
      items: [],
      page: 1,
      pageSize: 12,
    });
    expect(findMany).toHaveBeenCalledTimes(13);
    expect(
      findMany.mock.calls.slice(1).every(([args]) => {
        const where = (args as { where: { OR?: unknown[] } }).where;
        return Array.isArray(where.OR);
      }),
    ).toBe(true);
  });
});
