import { SubmissionForm } from '@/components/content/submission-form';
import { SubmissionPageShell } from '@/components/content/submission-page-shell';
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
    <SubmissionPageShell
      activeHref="/submit/resource"
      eyebrow="学习资源 / 01"
      title="填写学习资源"
    >
      <SubmissionForm availableTags={availableTags} kind="resource" />
    </SubmissionPageShell>
  );
}
