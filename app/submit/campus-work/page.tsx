import { SubmissionForm } from '@/components/content/submission-form';
import { SubmissionPageShell } from '@/components/content/submission-page-shell';
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
    <SubmissionPageShell
      activeHref="/submit/campus-work"
      eyebrow="校园工作 / 03"
      title="填写校园工作"
    >
      <aside className="privacy-note" aria-label="校园工作安全提示">
        <p>建议在公共场所见面。</p>
        <p>不要提前付款。</p>
        <p>平台不提供资金托管或担保。</p>
      </aside>
      <SubmissionForm availableTags={availableTags} kind="campus-work" />
    </SubmissionPageShell>
  );
}
