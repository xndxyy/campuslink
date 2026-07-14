import { SubmissionForm } from '@/components/content/submission-form';
import { requireVerifiedPageUser } from '@/lib/auth/page-access';
import { getDb } from '@/lib/db';
import { listAvailableTags, type TagAdapter } from '@/lib/domain/tags';

export default async function SubmitCampusWorkPage() {
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
    'CAMPUS_WORK',
  );
  return (
    <main className="page-shell form-page">
      <header>
        <p className="eyebrow">校园互助 / 03</p>
        <h1>发布校园工作</h1>
        <p>说明工作内容、地点、报酬与联系方法，标签最多选择五个。</p>
      </header>
      <aside className="privacy-note" aria-label="校园工作安全提示">
        <p>建议在公共场所见面。</p>
        <p>不要提前付款。</p>
        <p>平台不提供资金托管或担保。</p>
      </aside>
      <SubmissionForm availableTags={availableTags} kind="campus-work" />
    </main>
  );
}
