const forumStatusLabels: Record<string, string> = {
  ARCHIVED: '已归档',
  DRAFT: '草稿',
  HIDDEN: '已隐藏',
  PENDING: '待审核',
  PUBLISHED: '已发布',
  REJECTED: '未通过',
};

export function forumStatusLabel(status: string) {
  return forumStatusLabels[status] ?? '未知状态';
}
