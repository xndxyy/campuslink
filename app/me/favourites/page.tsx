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
          <p className="eyebrow">Verified campus account required</p>
          <h1>Sign in to view your favourites</h1>
          <Link href="/auth/sign-in">Go to sign in</Link>
        </section>
      </main>
    );
  }
  return (
    <main className="page-shell">
      <header className="section-masthead">
        <div>
          <p className="eyebrow">Personal reading list</p>
          <h1>My favourites</h1>
        </div>
      </header>
      {result.items.length === 0 ? (
        <section className="empty-state">
          <h2>No saved content yet</h2>
          <p>在已发布的学习资源、二手物品或校园工作详情中添加收藏。</p>
          <Link href="/resources">Browse resources</Link>
        </section>
      ) : (
        <section className="favourite-grid" aria-label="Saved campus content">
          {result.items.map(({ item, targetId, targetType }) => (
            <article key={`${targetType}:${targetId}`}>
              <p className="eyebrow">{targetType.replaceAll('_', ' ')}</p>
              <h2>{String(item.title)}</h2>
              <p>{String(item.summary ?? item.description ?? '')}</p>
              <Link href={targetHref(targetType, targetId)}>
                View published item
              </Link>
            </article>
          ))}
        </section>
      )}
      <nav className="pagination" aria-label="Favourites pages">
        {result.page > 1 ? (
          <Link href={`/me/favourites?page=${result.page - 1}`}>Previous</Link>
        ) : null}
        {result.hasNext ? (
          <Link href={`/me/favourites?page=${result.page + 1}`}>Next</Link>
        ) : null}
      </nav>
    </main>
  );
}
