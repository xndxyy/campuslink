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
    vi.mocked(db.resource.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        author: { name: 'Ada' },
        courseCode: 'CS101',
        createdAt: new Date('2026-07-12T10:00:00Z'),
        id: 'resource_1',
        summary: 'Safe summary',
        tags: ['algorithms'],
        title: 'Algorithms',
      });

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
});
