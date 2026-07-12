import { notFound } from 'next/navigation';
import { PublicDetail } from '@/components/content/public-detail';
import { loadPublicDetail } from '@/lib/domain/public-content';
import { getCurrentUser } from '@/lib/auth/auth-service';
import { loadEngagementViewerState } from '@/lib/domain/engagement-view';

export default async function ResourceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let item = null;
  try {
    item = await loadPublicDetail('resource', id);
  } catch {
    return (
      <main className="page-shell">
        <p className="notice error-state">资源数据库暂时不可用。</p>
      </main>
    );
  }
  if (!item) notFound();
  return (
    <PublicDetail
      canDownloadDocuments={Boolean(await getCurrentUser())}
      engagement={await loadEngagementViewerState('resource', id)}
      item={item}
      kind="resource"
    />
  );
}
