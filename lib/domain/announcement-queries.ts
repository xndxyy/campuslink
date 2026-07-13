import { getDefaultCampusSlug } from '@/lib/config';
import { AnnouncementForbiddenError } from './announcements';
import type { StaffActor } from './moderation';

export interface AnnouncementSummary {
  cover: { id: string } | null;
  id: string;
  isPinned: boolean;
  publishedAt: Date;
  title: string;
}

export interface PublicAnnouncement extends AnnouncementSummary {
  body: string;
}

interface AnnouncementQueryDelegate {
  findFirst(
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
  findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
}

export interface AnnouncementQueryAdapter {
  announcement: AnnouncementQueryDelegate;
}

const announcementOrder = [
  { isPinned: 'desc' },
  { publishedAt: 'desc' },
  { id: 'desc' },
] as const;

const summarySelect = {
  cover: { select: { id: true } },
  id: true,
  isPinned: true,
  publishedAt: true,
  title: true,
} as const;

const publicSelect = { body: true, ...summarySelect } as const;

function activeCampus(campusSlug: string) {
  return { campus: { is: { isActive: true, slug: campusSlug } } };
}

function boundedTake(value: number | undefined) {
  return Math.min(Math.max(value ?? 50, 1), 100);
}

export async function getHomeAnnouncement(
  adapter: AnnouncementQueryAdapter,
  campusSlug = getDefaultCampusSlug(),
): Promise<AnnouncementSummary | null> {
  const announcements = await adapter.announcement.findMany({
    orderBy: announcementOrder,
    select: summarySelect,
    take: 1,
    where: activeCampus(campusSlug),
  });
  return (
    (announcements[0] as unknown as AnnouncementSummary | undefined) ?? null
  );
}

export async function listAdminAnnouncements(
  adapter: AnnouncementQueryAdapter,
  actor: StaffActor,
  options: { take?: number } = {},
): Promise<AnnouncementSummary[]> {
  if (actor.role !== 'ADMIN') throw new AnnouncementForbiddenError();
  return (await adapter.announcement.findMany({
    orderBy: announcementOrder,
    select: summarySelect,
    take: boundedTake(options.take),
    where: { campusId: actor.campusId },
  })) as unknown as AnnouncementSummary[];
}

export async function listPublicAnnouncements(
  adapter: AnnouncementQueryAdapter,
  options: { campusSlug?: string; take?: number } = {},
): Promise<PublicAnnouncement[]> {
  return (await adapter.announcement.findMany({
    orderBy: announcementOrder,
    select: publicSelect,
    take: boundedTake(options.take),
    where: activeCampus(options.campusSlug ?? getDefaultCampusSlug()),
  })) as unknown as PublicAnnouncement[];
}

export async function getPublicAnnouncement(
  adapter: AnnouncementQueryAdapter,
  selectedId: string | undefined,
  campusSlug = getDefaultCampusSlug(),
): Promise<PublicAnnouncement | null> {
  const id = selectedId?.trim();
  if (!id || id.length > 191) return null;
  return (await adapter.announcement.findFirst({
    select: publicSelect,
    where: { ...activeCampus(campusSlug), id },
  })) as PublicAnnouncement | null;
}
