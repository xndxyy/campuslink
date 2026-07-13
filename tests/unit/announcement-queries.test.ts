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
});
