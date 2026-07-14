import { SubmissionForm } from '@/components/content/submission-form';
import { requireVerifiedPageUser } from '@/lib/auth/page-access';
import { getDb } from '@/lib/db';
import { listAvailableTags, type TagAdapter } from '@/lib/domain/tags';

export default async function SubmitResourcePage() {
  const user = await requireVerifiedPageUser();
  const availableTags = await listAvailableTags(
    getDb() as unknown as TagAdapter,
    {
      campusId: user.campusId,
      emailVerifiedAt: user.emailVerifiedAt,
      id: user.id,
      role: user.role,
      status: user.status,
    },
    'RESOURCE',
  );
  return (
    <main className="page-shell form-page">
      <header>
        <p className="eyebrow">知识共享 / 01</p>
        <h1>提交学习资源</h1>
        <p>上传至少一份文档。所有内容在公开前都会由校园审核员检查。</p>
      </header>
      <SubmissionForm availableTags={availableTags} kind="resource" />
    </main>
  );
}
