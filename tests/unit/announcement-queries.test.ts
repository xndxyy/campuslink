import { describe, expect, it, vi } from 'vitest';

import {
  getHomeAnnouncement,
  getPublicAnnouncement,
  listAdminAnnouncements,
  listPublicAnnouncements,
  type AnnouncementQueryAdapter,
} from '@/lib/domain/announcement-queries';
import { AnnouncementForbiddenError } from '@/lib/domain/announcements';

function database() {
  return {
    announcement: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
  } as unknown as AnnouncementQueryAdapter;
}

const orderBy = [{ isPinned: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }];

describe('announcement read queries', () => {
  it('selects exactly one safe home announcement from the active default campus', async () => {
    const adapter = database();

    await getHomeAnnouncement(adapter, 'campuslink');

    expect(adapter.announcement.findMany).toHaveBeenCalledWith({
      orderBy,
      select: {
        cover: { select: { id: true } },
        id: true,
        isPinned: true,
        publishedAt: true,
        title: true,
      },
      take: 1,
      where: {
        campus: { is: { isActive: true, slug: 'campuslink' } },
      },
    });
    expect(adapter.announcement.findFirst).not.toHaveBeenCalled();
  });

  it('keeps the administrator list ADMIN-only, campus-scoped, stable, and bounded', async () => {
    const adapter = database();
    const admin = {
      campusId: 'campus_1',
      id: 'admin_1',
      role: 'ADMIN' as const,
    };

    await listAdminAnnouncements(adapter, admin, { take: 5_000 });

    expect(adapter.announcement.findMany).toHaveBeenCalledWith({
      orderBy,
      select: {
        cover: { select: { id: true } },
        id: true,
        isPinned: true,
        publishedAt: true,
        title: true,
      },
      take: 100,
      where: { campusId: 'campus_1' },
    });

    await expect(
      listAdminAnnouncements(adapter, {
        ...admin,
        role: 'MODERATOR',
      }),
    ).rejects.toBeInstanceOf(AnnouncementForbiddenError);
  });

  it('returns a bounded public history without private author or storage fields', async () => {
    const adapter = database();

    await listPublicAnnouncements(adapter, {
      campusSlug: 'campuslink',
      take: 0,
    });

    expect(adapter.announcement.findMany).toHaveBeenCalledWith({
      orderBy,
      select: {
        body: true,
        cover: { select: { id: true } },
        id: true,
        isPinned: true,
        publishedAt: true,
        title: true,
      },
      take: 1,
      where: {
        campus: { is: { isActive: true, slug: 'campuslink' } },
      },
    });
  });

  it('maps public list records to the exact six-field DTO whitelist', async () => {
    const adapter = database();
    const publishedAt = new Date('2026-07-14T01:02:03.000Z');
    vi.mocked(adapter.announcement.findMany).mockResolvedValueOnce([
      {
        body: '纯文本公告正文',
        campus: { slug: 'must-not-leak' },
        cover: { id: 'asset_1', storageKey: 'must-not-leak' },
        id: 'announcement_1',
        isPinned: true,
        publishedAt,
        title: '校园公告',
      },
    ]);

    const result = await listPublicAnnouncements(adapter, {
      campusSlug: 'campuslink',
    });

    expect(result).toStrictEqual([
      {
        body: '纯文本公告正文',
        coverAssetId: 'asset_1',
        id: 'announcement_1',
        isPinned: true,
        publishedAt,
        title: '校园公告',
      },
    ]);
    expect(Object.keys(result[0]!).sort()).toStrictEqual(
      ['body', 'coverAssetId', 'id', 'isPinned', 'publishedAt', 'title'].sort(),
    );
  });

  it('scopes a URL-selected announcement to the active default campus and rejects invalid IDs', async () => {
    const adapter = database();

    await getPublicAnnouncement(adapter, 'announcement_1', 'campuslink');

    expect(adapter.announcement.findFirst).toHaveBeenCalledWith({
      select: {
        body: true,
        cover: { select: { id: true } },
        id: true,
        isPinned: true,
        publishedAt: true,
        title: true,
      },
      where: {
        campus: { is: { isActive: true, slug: 'campuslink' } },
        id: 'announcement_1',
      },
    });

    vi.mocked(adapter.announcement.findFirst).mockClear();
    await expect(
      getPublicAnnouncement(adapter, ' '.repeat(200), 'campuslink'),
    ).resolves.toBeNull();
    expect(adapter.announcement.findFirst).not.toHaveBeenCalled();
  });

  it('maps a selected record to the exact six-field DTO whitelist', async () => {
    const adapter = database();
    const publishedAt = new Date('2026-07-14T02:03:04.000Z');
    vi.mocked(adapter.announcement.findFirst).mockResolvedValueOnce({
      author: { email: 'must-not-leak@example.test' },
      body: '详情正文',
      cover: null,
      id: 'announcement_2',
      isPinned: false,
      publishedAt,
      storageKey: 'must-not-leak',
      title: '详情公告',
    });

    const result = await getPublicAnnouncement(
      adapter,
      'announcement_2',
      'campuslink',
    );

    expect(result).toStrictEqual({
      body: '详情正文',
      coverAssetId: null,
      id: 'announcement_2',
      isPinned: false,
      publishedAt,
      title: '详情公告',
    });
    expect(Object.keys(result!).sort()).toStrictEqual(
      ['body', 'coverAssetId', 'id', 'isPinned', 'publishedAt', 'title'].sort(),
    );
  });
});
