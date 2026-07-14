import { notFound, redirect } from 'next/navigation';
import { EditContentForm } from '@/components/content/edit-content-form';
import { requireVerifiedUser } from '@/lib/auth/guards';
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
  if (!['resource', 'marketplace', 'job'].includes(rawKind)) notFound();
  const kind = rawKind as ContentKind;
  let user;
  try {
    user = await requireVerifiedUser();
  } catch {
    redirect('/auth/sign-in');
  }
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
    kind === 'job'
      ? Promise.resolve([])
      : listAvailableTags(
          database as unknown as TagAdapter,
          actor,
          kind === 'resource' ? 'RESOURCE' : 'MARKETPLACE',
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
