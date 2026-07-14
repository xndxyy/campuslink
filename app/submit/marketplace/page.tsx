import { SubmissionForm } from '@/components/content/submission-form';
import { requireVerifiedUser } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import { listAvailableTags, type TagAdapter } from '@/lib/domain/tags';
import { redirect } from 'next/navigation';

export default async function SubmitMarketplacePage() {
  let user;
  try {
    user = await requireVerifiedUser();
  } catch {
    redirect('/auth/sign-in');
  }
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
    <main className="page-shell form-page">
      <header>
        <p className="eyebrow">循环市集 / 02</p>
        <h1>发布二手物品</h1>
        <p>
          清楚描述物品与取货区域。联系方式只保存于受保护记录，不会公开展示。
        </p>
      </header>
      <SubmissionForm availableTags={availableTags} kind="marketplace" />
    </main>
  );
}
