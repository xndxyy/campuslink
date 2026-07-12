import { notFound, redirect } from 'next/navigation';
import { EditContentForm } from '@/components/content/edit-content-form';
import { requireVerifiedUser } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import {
  type ContentAdapter,
  type ContentKind,
  getOwnedContent,
} from '@/lib/domain/content-service';

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
  const item = await getOwnedContent(
    getDb() as unknown as ContentAdapter,
    { campusId: user.campusId, id: user.id, role: user.role },
    kind,
    id,
  );
  if (!item || !['DRAFT', 'REJECTED'].includes(String(item.status))) notFound();
  return (
    <main className="page-shell form-page">
      <header>
        <p className="eyebrow">编辑草稿</p>
        <h1>{String(item.title)}</h1>
        <p>附件保持不变。保存后内容处于草稿状态，可从“我的提交”重新送审。</p>
      </header>
      <EditContentForm item={item} kind={kind} />
    </main>
  );
}
