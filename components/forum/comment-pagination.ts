type ForumView = 'discussion' | 'tree-hole';

export function parseCommentPage(value: string | string[] | undefined) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= 10_000 ? page : 1;
}

export function lastCommentPage(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function commentPageHref({
  owner,
  page,
  postId,
  view,
}: {
  owner: boolean;
  page: number;
  postId: string;
  view: ForumView;
}) {
  const params = new URLSearchParams({ view });
  if (owner) params.set('owner', 'true');
  params.set('commentPage', String(page));
  return `/forum/${encodeURIComponent(postId)}?${params.toString()}`;
}
