import { SubmissionForm } from '@/components/content/submission-form';
import { SubmissionPageShell } from '@/components/content/submission-page-shell';
import { requireVerifiedPageUser } from '@/lib/auth/page-access';
import { getDb } from '@/lib/db';
import { listAvailableTags, type TagAdapter } from '@/lib/domain/tags';

export default async function SubmitMarketplacePage() {
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
    'MARKETPLACE',
  );
  return (
    <SubmissionPageShell
      activeHref="/submit/marketplace"
      eyebrow="二手交易 / 02"
      title="填写二手物品"
    >
      <SubmissionForm availableTags={availableTags} kind="marketplace" />
    </SubmissionPageShell>
  );
}
