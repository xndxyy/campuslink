export interface RecentContentItem {
  createdAt: Date;
  id: string;
  title: string;
  type: 'resources' | 'marketplace' | 'jobs';
}

export function mergeRecentContent(
  groups: readonly (readonly RecentContentItem[])[],
  limit: number,
) {
  return groups
    .flat()
    .sort(
      (left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() ||
        right.id.localeCompare(left.id),
    )
    .slice(0, Math.max(0, limit));
}
