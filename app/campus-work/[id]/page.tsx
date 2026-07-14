import { notFound } from 'next/navigation';

import { PublicDetail } from '@/components/content/public-detail';
import { loadEngagementViewerState } from '@/lib/domain/engagement-view';
import { loadPublicDetail } from '@/lib/domain/public-content';

export default async function CampusWorkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let item = null;
  try {
    item = await loadPublicDetail('campus-work', id);
  } catch {
    return (
      <main className="page-shell">
        <p className="notice error-state">校园工作暂时无法加载。</p>
      </main>
    );
  }
  if (!item) notFound();
  return (
    <PublicDetail
      engagement={await loadEngagementViewerState('campus-work', id)}
      item={item}
      kind="campus-work"
    />
  );
}
