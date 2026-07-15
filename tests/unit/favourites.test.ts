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
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation(value),
    ),
    favourite: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({ id: 'favourite_1' })),
    },
    campusWorkPost: { findFirst: vi.fn(async () => null) },
    marketplaceItem: { findFirst: vi.fn(async () => null) },
    resource: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => ({
        author: { name: 'Ada' },
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

function rawPaginatedAdapter(total: number) {
  const createdAt = new Date('2026-07-12T12:00:00Z');
  const records = Array.from({ length: total }, (_, index) => ({
    favouritedAt: createdAt,
    favouriteId: `fav_${String(total - index).padStart(4, '0')}`,
    item: {
      author: { name: 'Ada' },
      createdAt: createdAt.toISOString(),
      id: `resource_${String(index).padStart(4, '0')}`,
      summary: `Summary for resource_${String(index).padStart(4, '0')}`,
      tags: ['algorithms'],
      title: `Title for resource_${String(index).padStart(4, '0')}`,
    },
    targetId: `resource_${String(index).padStart(4, '0')}`,
    targetType: 'RESOURCE' as const,
  }));
  const queryRaw = vi.fn(async (...args: unknown[]) => {
    const values = args.slice(1);
    const take = Number(values.at(-2));
    const offset = Number(values.at(-1));
    return records.slice(offset, offset + take);
  });
  const db = adapter({
    $queryRaw: queryRaw,
  });
  return { db, queryRaw, records };
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

  it('uses one bounded parameterized visible-content query without cleanup', async () => {
    const { db, queryRaw } = rawPaginatedAdapter(13);

    const result = await listUserFavourites(db, actor, {
      page: 1,
      pageSize: 12,
    });

    expect(result.items).toHaveLength(12);
    expect(result.hasNext).toBe(true);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = queryRaw.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const sql = strings.join('?');
    expect(sql).toMatch(/UNION ALL/i);
    expect(sql).toMatch(/JOIN "Resource"/);
    expect(sql).toMatch(/JOIN "MarketplaceItem"/);
    expect(sql).toMatch(/JOIN "CampusWorkPost"/);
    expect(sql).toMatch(/status[^?]*PUBLISHED/i);
    expect(sql).not.toContain(actor.id);
    expect(sql).not.toMatch(/jsonb_build_object\([^)]*contact/i);
    expect(values).toContain(actor.id);
    expect(values).toContain(actor.campusId);
    expect(values.at(-2)).toBe(13);
    expect(values.at(-1)).toBe(0);
    expect(db.favourite.findMany).not.toHaveBeenCalled();
    expect(db.favourite.deleteMany).not.toHaveBeenCalled();
    expect(result.items[0]).not.toHaveProperty('contact');
    expect(result.items[0]?.item).not.toHaveProperty('contact');
  });

  it('reaches pages beyond 500 visible favourites without an arbitrary scan cap', async () => {
    const { db, queryRaw, records } = rawPaginatedAdapter(551);

    const result = await listUserFavourites(db, actor, {
      page: 11,
      pageSize: 50,
    });

    expect(result.items).toHaveLength(50);
    expect(result.items[0]?.targetId).toBe(records[500]?.targetId);
    expect(result.items[49]?.targetId).toBe(records[549]?.targetId);
    expect(result.hasNext).toBe(true);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('stops at page 50 without hiding the previous page next link', async () => {
    const page50Source = rawPaginatedAdapter(2502);
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

    const page49Source = rawPaginatedAdapter(2502);
    const page49 = await listUserFavourites(page49Source.db, actor, {
      page: 49,
      pageSize: 50,
    });
    expect(page49.page).toBe(49);
    expect(page49.hasNext).toBe(true);
  });

  it('does not loop or delete when more than 500 stale rows precede visibility', async () => {
    const { db, queryRaw, records } = rawPaginatedAdapter(2);
    const staleBatch = Array.from(
      { length: 50 },
      (_, index) =>
        ({
          createdAt: new Date('2026-07-12T12:00:00Z'),
          id: `stale_${index}`,
          targetId: `hidden_${index}`,
          targetType: 'RESOURCE',
        }) as const,
    );
    let staleCalls = 0;
    vi.mocked(db.favourite.findMany).mockImplementation(async () => {
      staleCalls += 1;
      return staleCalls <= 11 ? [...staleBatch] : [];
    });

    const result = await listUserFavourites(db, actor, {
      page: 1,
      pageSize: 2,
    });

    expect(result.items.map((item) => item.targetId)).toEqual(
      records.map((record) => record.targetId),
    );
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(db.favourite.findMany).not.toHaveBeenCalled();
    expect(db.favourite.deleteMany).not.toHaveBeenCalled();
  });
});
