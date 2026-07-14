import { notFound, permanentRedirect } from 'next/navigation';
import { EditContentForm } from '@/components/content/edit-content-form';
import { requireVerifiedPageUser } from '@/lib/auth/page-access';
import { getDb } from '@/lib/db';
import {
  type ContentAdapter,
  type ContentKind,
  getOwnedContent,
} from '@/lib/domain/content-service';
import { listAvailableTags, type TagAdapter } from '@/lib/domain/tags';

export default async function EditSubmissionPage({
  params,
}: {
  params: Promise<{ id: string; kind: string }>;
}) {
  const { id, kind: rawKind } = await params;
  if (rawKind === 'job') {
    permanentRedirect(`/me/submissions/campus-work/${id}/edit`);
  }
  if (!['resource', 'marketplace', 'campus-work'].includes(rawKind)) {
    notFound();
  }
  const kind = rawKind as Exclude<ContentKind, 'job'>;
  const user = await requireVerifiedPageUser();
  const database = getDb();
  const actor = {
    campusId: user.campusId,
    emailVerifiedAt: user.emailVerifiedAt,
    id: user.id,
    role: user.role,
    status: user.status,
  };
  const [item, availableTags] = await Promise.all([
    getOwnedContent(database as unknown as ContentAdapter, actor, kind, id),
    listAvailableTags(
      database as unknown as TagAdapter,
      actor,
      kind === 'resource'
        ? 'RESOURCE'
        : kind === 'marketplace'
          ? 'MARKETPLACE'
          : 'CAMPUS_WORK',
    ),
  ]);
  if (!item || !['DRAFT', 'REJECTED'].includes(String(item.status))) notFound();
  return (
    <main className="page-shell form-page">
      <header>
        <p className="eyebrow">编辑草稿</p>
        <h1>{String(item.title)}</h1>
        <p>附件保持不变。保存后内容处于草稿状态，可从“我的提交”重新送审。</p>
      </header>
      <EditContentForm availableTags={availableTags} item={item} kind={kind} />
    </main>
  );
}
