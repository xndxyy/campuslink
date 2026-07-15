type ApiResult = Record<string, unknown> | null | undefined;

export function contentMutationErrorMessage(
  result: ApiResult,
  fallback: string,
) {
  if (result?.code === 'CONTENT_BLOCKED') {
    const categories = Array.isArray(result.categories)
      ? result.categories.filter(
          (category): category is string => typeof category === 'string',
        )
      : [];
    const parts = [
      categories.length ? `违规类别：${categories.join('、')}` : '',
      typeof result.reason === 'string' ? `原因：${result.reason}` : '',
      typeof result.suggestion === 'string' ? `建议：${result.suggestion}` : '',
    ].filter(Boolean);
    if (parts.length) return parts.join('。');
  }
  return typeof result?.message === 'string' ? result.message : fallback;
}

export function contentMutationSuccessMessage(result: ApiResult) {
  if (result?.status === 'PUBLISHED') return '发布成功，内容已公开。';
  if (result?.status === 'PENDING') {
    return typeof result.message === 'string'
      ? result.message
      : '内容正在人工审核。';
  }
  return typeof result?.message === 'string' ? result.message : '操作已完成。';
}
