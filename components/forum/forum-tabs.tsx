import Link from 'next/link';

export type ForumView = 'discussion' | 'tree-hole';

export function buildForumHref(
  current: Record<string, string | undefined>,
  changes: Record<string, string | number | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...changes })) {
    if (
      value !== undefined &&
      value !== '' &&
      !(key === 'page' && value === 1)
    ) {
      params.set(key, String(value));
    }
  }
  if (!params.has('view')) params.set('view', 'discussion');
  return `/forum?${params.toString()}`;
}

export function ForumTabs({
  current,
  view,
}: {
  current: Record<string, string | undefined>;
  view: ForumView;
}) {
  return (
    <nav aria-label="论坛视图" className="forum-tabs" role="tablist">
      <Link
        aria-selected={view === 'discussion'}
        href={buildForumHref(current, { page: 1, view: 'discussion' })}
        role="tab"
      >
        普通论坛
      </Link>
      <Link
        aria-selected={view === 'tree-hole'}
        href={buildForumHref(current, { page: 1, view: 'tree-hole' })}
        role="tab"
      >
        匿名树洞
      </Link>
    </nav>
  );
}
