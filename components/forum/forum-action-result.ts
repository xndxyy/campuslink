export type ForumDeleteOutcome = {
  kind: 'archived' | 'deleted';
  message: string;
};

export function parseForumDeleteResult(value: unknown): ForumDeleteOutcome {
  if (!value || typeof value !== 'object') {
    throw new Error('删除结果无效，请稍后重试。');
  }
  const result = value as { archived?: unknown; deleted?: unknown };
  if (result.archived === true && result.deleted === false) {
    return {
      kind: 'archived',
      message: '帖子有处理中举报，已归档并停止展示。',
    };
  }
  if (result.archived === false && result.deleted === true) {
    return { kind: 'deleted', message: '帖子已删除。' };
  }
  throw new Error('删除结果无效，请稍后重试。');
}
