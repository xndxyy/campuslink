import { notFound } from 'next/navigation';
import { PublicDetail } from '@/components/content/public-detail';
import { loadPublicDetail } from '@/lib/domain/public-content';

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let item = null;
  try {
    item = await loadPublicDetail('job', id);
  } catch {
    return (
      <main className="page-shell">
        <p className="notice error-state">招聘数据库暂时不可用。</p>
      </main>
    );
  }
  if (!item) notFound();
  return <PublicDetail canDownloadDocuments={false} item={item} kind="job" />;
}
