import { ForumPostForm } from '@/components/forum/forum-post-form';
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
    <main className="page-shell form-page forum-submit-page">
      <header>
        <p className="eyebrow">校园论坛 / 04</p>
        <h1>发布普通论坛</h1>
        <p>使用真实校园昵称参与公开讨论，帖子支持评论、点赞与举报。</p>
      </header>
      <ForumPostForm categories={categories} kind="DISCUSSION" />
    </main>
  );
}
