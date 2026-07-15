import { ForumPostForm } from '@/components/forum/forum-post-form';
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
    <main className="page-shell form-page forum-submit-page">
      <header>
        <p className="eyebrow">校园论坛 / 匿名</p>
        <h1>发布匿名树洞</h1>
        <p>所有人匿名，仅开放发布、点赞与举报，不提供评论。</p>
      </header>
      <ForumPostForm categories={categories} kind="TREE_HOLE" />
    </main>
  );
}
