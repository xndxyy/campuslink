import { AnnouncementCenter } from '@/components/announcements/announcement-center';
import { getDb } from '@/lib/db';
import {
  getPublicAnnouncement,
  listPublicAnnouncements,
  type AnnouncementQueryAdapter,
  type PublicAnnouncement,
} from '@/lib/domain/announcement-queries';

export const dynamic = 'force-dynamic';

export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requested =
    typeof params.announcement === 'string' ? params.announcement : undefined;
  let announcements: PublicAnnouncement[] = [];
  let selected: PublicAnnouncement | null = null;
  let error: string | undefined;
  try {
    const adapter = getDb() as unknown as AnnouncementQueryAdapter;
    [announcements, selected] = await Promise.all([
      listPublicAnnouncements(adapter),
      getPublicAnnouncement(adapter, requested),
    ]);
  } catch {
    error = '请稍后刷新页面重试。';
  }

  return (
    <AnnouncementCenter
      announcements={announcements}
      error={error}
      selected={selected}
      selectionMissing={Boolean(requested && !selected && !error)}
    />
  );
}
