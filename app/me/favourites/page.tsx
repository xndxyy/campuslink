import Link from 'next/link';

import { requireVerifiedUser } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import {
  listUserFavourites,
  type FavouritesAdapter,
} from '@/lib/domain/favourites';

export const dynamic = 'force-dynamic';

function targetHref(
  targetType: 'RESOURCE' | 'MARKETPLACE_ITEM' | 'JOB_POST',
  id: string,
) {
  return targetType === 'RESOURCE'
    ? `/resources/${id}`
    : targetType === 'MARKETPLACE_ITEM'
      ? `/marketplace/${id}`
      : `/campus-work/${id}`;
}

const targetLabels = {
  JOB_POST: '校园工作',
  MARKETPLACE_ITEM: '二手物品',
  RESOURCE: '学习资源',
} as const;

export default async function FavouritesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  let result = null;
  try {
    const user = await requireVerifiedUser();
    const { page } = await searchParams;
    result = await listUserFavourites(
      getDb() as unknown as FavouritesAdapter,
      { campusId: user.campusId, id: user.id },
      { page: Number(page) || 1, pageSize: 12 },
    );
  } catch {
    return (
      <main className="page-shell">
        <section className="empty-state">
          <p className="eyebrow">需要验证身份</p>
          <h1>登录后查看收藏</h1>
          <Link href="/auth/sign-in">前往登录</Link>
        </section>
      </main>
    );
  }
  return (
    <main className="page-shell">
      <header className="section-masthead">
        <div>
          <p className="eyebrow">个人收藏</p>
          <h1>我的收藏</h1>
        </div>
      </header>
      {result.items.length === 0 ? (
        <section className="empty-state">
          <h2>还没有收藏内容</h2>
          <p>在已发布的学习资源、二手物品或校园工作详情中添加收藏。</p>
          <Link href="/resources">浏览学习资源</Link>
        </section>
      ) : (
        <section className="favourite-grid" aria-label="已收藏的校园内容">
          {result.items.map(({ item, targetId, targetType }) => (
            <article key={`${targetType}:${targetId}`}>
              <p className="eyebrow">{targetLabels[targetType]}</p>
              <h2>{String(item.title)}</h2>
              <p>{String(item.summary ?? item.description ?? '')}</p>
              <Link href={targetHref(targetType, targetId)}>
                查看已发布内容
              </Link>
            </article>
          ))}
        </section>
      )}
      <nav className="pagination" aria-label="收藏分页">
        {result.page > 1 ? (
          <Link href={`/me/favourites?page=${result.page - 1}`}>上一页</Link>
        ) : null}
        {result.hasNext ? (
          <Link href={`/me/favourites?page=${result.page + 1}`}>下一页</Link>
        ) : null}
      </nav>
    </main>
  );
}
