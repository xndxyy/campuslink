import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContentAdapter } from '@/lib/domain/content-service';
import { loadPublicList } from '@/lib/domain/public-content';

const database = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock('@/lib/db', () => database);

describe('public content list loading', () => {
  beforeEach(() => {
    database.getDb.mockReset();
  });

  it('returns an invalid marketplace price range before database access', async () => {
    const list = vi.fn();

    const result = await loadPublicList(
      'marketplace',
      { maxPrice: '9.99', minPrice: '10.00' },
      { list },
    );

    expect(result).toEqual({
      filterError: '最高价不能低于最低价',
      filters: { maxPrice: '9.99', minPrice: '10.00' },
      items: [],
      page: 1,
      pageSize: 12,
      query: {},
      total: 0,
    });
    expect(list).not.toHaveBeenCalled();
    expect(database.getDb).not.toHaveBeenCalled();
  });

  it('converts valid yuan filters for the list service and keeps raw values', async () => {
    const adapter = {} as ContentAdapter;
    const list = vi.fn(async () => ({
      items: [],
      page: 1,
      pageSize: 12,
      total: 0,
    }));

    const result = await loadPublicList(
      'marketplace',
      { maxPrice: '20.00', minPrice: '12.50' },
      { adapter, list },
    );

    expect(list).toHaveBeenCalledWith(adapter, 'marketplace', {
      maxPriceCents: 2000,
      minPriceCents: 1250,
      page: 1,
      pageSize: 12,
    });
    expect(result).toEqual({
      filters: { maxPrice: '20.00', minPrice: '12.50' },
      items: [],
      page: 1,
      pageSize: 12,
      query: {
        maxPriceCents: 2000,
        minPriceCents: 1250,
        page: 1,
        pageSize: 12,
      },
      total: 0,
    });
    expect(database.getDb).not.toHaveBeenCalled();
  });
});
