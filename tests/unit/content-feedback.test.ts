import { describe, expect, it } from 'vitest';

import {
  contentMutationErrorMessage,
  contentMutationSuccessMessage,
} from '@/lib/client/content-feedback';

describe('content mutation feedback', () => {
  it('presents blocked categories, reason, and actionable suggestion', () => {
    expect(
      contentMutationErrorMessage(
        {
          categories: ['广告垃圾', '诈骗引流'],
          code: 'CONTENT_BLOCKED',
          reason: '内容包含站外诱导信息',
          suggestion: '删除外链和转账引导后重新提交',
        },
        '操作失败。',
      ),
    ).toBe(
      '违规类别：广告垃圾、诈骗引流。原因：内容包含站外诱导信息。建议：删除外链和转账引导后重新提交',
    );
  });

  it('distinguishes published content from content pending manual review', () => {
    expect(contentMutationSuccessMessage({ status: 'PUBLISHED' })).toBe(
      '发布成功，内容已公开。',
    );
    expect(
      contentMutationSuccessMessage({
        message: '内容正在人工审核。',
        status: 'PENDING',
      }),
    ).toBe('内容正在人工审核。');
  });
});
