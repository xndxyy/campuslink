import { ForumPostForm } from '@/components/forum/forum-post-form';
import { SubmissionPageShell } from '@/components/content/submission-page-shell';
import { requireVerifiedPageUser } from '@/lib/auth/page-access';
import { getDb } from '@/lib/db';

export default async function SubmitTreeHolePage() {
  const user = await requireVerifiedPageUser();
  const categories = await getDb().forumCategory.findMany({
    orderBy: [{ label: 'asc' }, { id: 'asc' }],
    select: { label: true, slug: true },
    where: { campusId: user.campusId, isActive: true },
  });
  return (
    <SubmissionPageShell
      activeHref="/submit/tree-hole"
      eyebrow="匿名树洞 / 05"
      title="填写匿名树洞"
    >
      <ForumPostForm categories={categories} kind="TREE_HOLE" />
    </SubmissionPageShell>
  );
}
