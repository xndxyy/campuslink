import { getDefaultCampusSlug } from '@/lib/config';
import { AnnouncementForbiddenError } from './announcements';
import type { StaffActor } from './moderation';

export interface AnnouncementSummary {
  coverAssetId: string | null;
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

function mapSummary(record: Record<string, unknown>): AnnouncementSummary {
  const cover = record.cover as { id?: unknown } | null | undefined;
  return {
    coverAssetId: typeof cover?.id === 'string' ? cover.id : null,
    id: String(record.id),
    isPinned: record.isPinned === true,
    publishedAt:
      record.publishedAt instanceof Date
        ? record.publishedAt
        : new Date(String(record.publishedAt)),
    title: String(record.title),
  };
}

function mapPublic(record: Record<string, unknown>): PublicAnnouncement {
  return { body: String(record.body), ...mapSummary(record) };
}

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
  return announcements[0] ? mapSummary(announcements[0]) : null;
}

export async function listAdminAnnouncements(
  adapter: AnnouncementQueryAdapter,
  actor: StaffActor,
  options: { take?: number } = {},
): Promise<AnnouncementSummary[]> {
  if (actor.role !== 'ADMIN') throw new AnnouncementForbiddenError();
  const announcements = await adapter.announcement.findMany({
    orderBy: announcementOrder,
    select: summarySelect,
    take: boundedTake(options.take),
    where: { campusId: actor.campusId },
  });
  return announcements.map(mapSummary);
}

export async function listPublicAnnouncements(
  adapter: AnnouncementQueryAdapter,
  options: { campusSlug?: string; take?: number } = {},
): Promise<PublicAnnouncement[]> {
  const announcements = await adapter.announcement.findMany({
    orderBy: announcementOrder,
    select: publicSelect,
    take: boundedTake(options.take),
    where: activeCampus(options.campusSlug ?? getDefaultCampusSlug()),
  });
  return announcements.map(mapPublic);
}

export async function getPublicAnnouncement(
  adapter: AnnouncementQueryAdapter,
  selectedId: string | undefined,
  campusSlug = getDefaultCampusSlug(),
): Promise<PublicAnnouncement | null> {
  const id = selectedId?.trim();
  if (!id || id.length > 191) return null;
  const announcement = await adapter.announcement.findFirst({
    select: publicSelect,
    where: { ...activeCampus(campusSlug), id },
  });
  return announcement ? mapPublic(announcement) : null;
}
