import { ForumList } from '@/components/forum/forum-list';
import type { ForumView } from '@/components/forum/forum-tabs';
import { requireVerifiedPageUser } from '@/lib/auth/page-access';
import { getDefaultCampusSlug } from '@/lib/config';
import { getDb } from '@/lib/db';
import {
  type ForumActor,
  type ForumAdapter,
  listForumPosts,
} from '@/lib/domain/forum';

export const dynamic = 'force-dynamic';

function one(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : undefined;
}

export default async function ForumPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const view: ForumView =
    one(raw.view) === 'tree-hole' ? 'tree-hole' : 'discussion';
  let actor: ForumActor | null = null;
  if (view === 'tree-hole') {
    const user = await requireVerifiedPageUser();
    actor = {
      campusId: user.campusId,
      emailVerifiedAt: user.emailVerifiedAt,
      id: user.id,
      role: user.role,
      status: user.status,
    };
  }
  const category = one(raw.category);
  const text = one(raw.query);
  const requestedPage = Number(one(raw.page));
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;
  let result: Awaited<ReturnType<typeof listForumPosts>> | null = null;
  let error: string | undefined;
  let categories: Array<{ label: string; slug: string }> = [];
  try {
    const db = getDb();
    categories = await db.forumCategory.findMany({
      orderBy: [{ label: 'asc' }, { id: 'asc' }],
      select: { label: true, slug: true },
      where: actor
        ? { campusId: actor.campusId, isActive: true }
        : { campus: { slug: getDefaultCampusSlug() }, isActive: true },
    });
    result = await listForumPosts(db as unknown as ForumAdapter, actor, {
      ...(category ? { category } : {}),
      page,
      pageSize: 20,
      ...(text ? { query: text } : {}),
      view,
    });
  } catch {
    error = '论坛暂时无法加载，请稍后重试。';
  }
  return (
    <ForumList
      categories={categories}
      error={error}
      items={result?.items ?? []}
      page={result?.page ?? page}
      pageSize={result?.pageSize ?? 20}
      query={{ category, query: text }}
      total={result?.total ?? 0}
      view={view}
    />
  );
}
