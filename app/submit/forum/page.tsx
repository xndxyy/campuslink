import { ForumPostForm } from '@/components/forum/forum-post-form';
import { SubmissionPageShell } from '@/components/content/submission-page-shell';
import { requireVerifiedPageUser } from '@/lib/auth/page-access';
import { getDb } from '@/lib/db';

export default async function SubmitForumPage() {
  const user = await requireVerifiedPageUser();
  const categories = await getDb().forumCategory.findMany({
    orderBy: [{ label: 'asc' }, { id: 'asc' }],
    select: { label: true, slug: true },
    where: { campusId: user.campusId, isActive: true },
  });
  return (
    <SubmissionPageShell
      activeHref="/submit/forum"
      eyebrow="校园论坛 / 04"
      title="填写论坛帖子"
    >
      <ForumPostForm categories={categories} kind="DISCUSSION" />
    </SubmissionPageShell>
  );
}
