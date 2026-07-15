import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CommentList } from '@/components/forum/comment-list';
import { ForumActions } from '@/components/forum/forum-actions';
import { ForumPostForm } from '@/components/forum/forum-post-form';
import { forumStatusLabel } from '@/components/forum/forum-status';
import type { ForumView } from '@/components/forum/forum-tabs';
import { requireVerifiedPageUser } from '@/lib/auth/page-access';
import { requireVerifiedUser } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import {
  type ForumActor,
  type ForumAdapter,
  getForumPost,
  listForumComments,
} from '@/lib/domain/forum';
import { loadAnonymousIdentityKeyring } from '@/lib/security/anonymous-identity';

export const dynamic = 'force-dynamic';

type PresentedPost = {
  _count: { comments: number; likes: number };
  author?: { name: string | null };
  body: string;
  category: string;
  createdAt: Date;
  id: string;
  publicCode?: string;
  status: string;
  title: string;
};

export default async function ForumDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ owner?: string; view?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const view: ForumView =
    query.view === 'tree-hole' ? 'tree-hole' : 'discussion';
  const owner = query.owner === 'true';
  let actor: ForumActor | null = null;
  if (view === 'tree-hole' || owner) {
    const user = await requireVerifiedPageUser();
    actor = {
      campusId: user.campusId,
      emailVerifiedAt: user.emailVerifiedAt,
      id: user.id,
      role: user.role,
      status: user.status,
    };
  }
  const db = getDb();
  let post: PresentedPost;
  try {
    post = (await getForumPost(
      db as unknown as ForumAdapter,
      actor,
      { id, owner, view },
      owner && view === 'tree-hole'
        ? loadAnonymousIdentityKeyring()
        : undefined,
    )) as PresentedPost;
  } catch {
    notFound();
  }
  let comments: Array<{
    authorName: string;
    body: string;
    canManage: boolean;
    createdAt: string;
    id: string;
  }> = [];
  if (view === 'discussion' && post.status === 'PUBLISHED') {
    let viewerId: string | null = actor?.id ?? null;
    if (!viewerId) {
      try {
        viewerId = (await requireVerifiedUser()).id;
      } catch {
        viewerId = null;
      }
    }
    try {
      const result = await listForumComments(
        db as unknown as ForumAdapter,
        null,
        { page: 1, pageSize: 50, postId: id },
      );
      comments = result.items.map((comment) => ({
        authorName: comment.author.name ?? '校园同学',
        body: comment.body,
        canManage: comment.author.id === viewerId,
        createdAt: comment.createdAt.toISOString(),
        id: comment.id,
      }));
    } catch {
      comments = [];
    }
  }
  const categories = owner
    ? await db.forumCategory.findMany({
        orderBy: [{ label: 'asc' }, { id: 'asc' }],
        select: { label: true, slug: true },
        where: { campusId: actor!.campusId, isActive: true },
      })
    : [];
  return (
    <main className="page-shell forum-detail-shell">
      <Link className="forum-back-link" href={`/forum?view=${view}`}>
        返回{view === 'tree-hole' ? '匿名树洞' : '校园论坛'}
      </Link>
      <article className="forum-detail">
        <header>
          <p className="eyebrow">
            {view === 'tree-hole'
              ? `树洞 ${post.publicCode ?? ''}`
              : (post.author?.name ?? '校园同学')}{' '}
            · {post.category}
          </p>
          <h1>{post.title}</h1>
          <p>
            <time dateTime={post.createdAt.toISOString()}>
              {post.createdAt.toLocaleString('zh-CN')}
            </time>
            {owner ? ` · 本人发布 · ${forumStatusLabel(post.status)}` : ''}
          </p>
        </header>
        <div className="forum-post-body">{post.body}</div>
      </article>
      <ForumActions
        id={post.id}
        initialLikeCount={post._count.likes}
        owner={owner}
        status={post.status}
        view={view}
      />
      {owner ? (
        <section className="forum-owner-editor">
          <h2>编辑帖子</h2>
          <ForumPostForm
            categories={categories}
            initialPost={{
              body: post.body,
              category: post.category,
              id: post.id,
              title: post.title,
            }}
            kind={view === 'tree-hole' ? 'TREE_HOLE' : 'DISCUSSION'}
          />
        </section>
      ) : null}
      {view === 'discussion' && post.status === 'PUBLISHED' ? (
        <CommentList comments={comments} postId={post.id} />
      ) : null}
    </main>
  );
}
