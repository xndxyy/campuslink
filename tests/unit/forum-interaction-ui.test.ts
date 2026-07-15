import { describe, expect, it } from 'vitest';

import {
  commentPageAfterDelete,
  commentPageHref,
  lastCommentPage,
  parseCommentPage,
} from '@/components/forum/comment-pagination';
import {
  parseForumCommentDeleteResult,
  parseForumDeleteResult,
} from '@/components/forum/forum-action-result';

describe('forum comment pagination', () => {
  it('accepts only safe positive comment pages', () => {
    expect(parseCommentPage('3')).toBe(3);
    expect(parseCommentPage(undefined)).toBe(1);
    expect(parseCommentPage('0')).toBe(1);
    expect(parseCommentPage('1.5')).toBe(1);
    expect(parseCommentPage('10001')).toBe(1);
  });

  it('builds owner-aware discussion page links and computes the last page', () => {
    expect(lastCommentPage(51, 20)).toBe(3);
    expect(lastCommentPage(0, 20)).toBe(1);
    expect(
      commentPageHref({
        owner: true,
        page: 3,
        postId: 'post_1',
        view: 'discussion',
      }),
    ).toBe('/forum/post_1?view=discussion&owner=true&commentPage=3');
  });

  it('clamps the current page after deleting the last comment on a page', () => {
    expect(commentPageAfterDelete({ page: 3, pageSize: 20, total: 41 })).toBe(
      2,
    );
    expect(commentPageAfterDelete({ page: 2, pageSize: 20, total: 21 })).toBe(
      1,
    );
    expect(commentPageAfterDelete({ page: 2, pageSize: 20, total: 40 })).toBe(
      2,
    );
  });
});

describe('forum delete results', () => {
  it('distinguishes archived and permanently deleted outcomes', () => {
    expect(
      parseForumDeleteResult({ archived: true, deleted: false }),
    ).toStrictEqual({
      kind: 'archived',
      message: '帖子有处理中举报，已归档并停止展示。',
    });
    expect(
      parseForumDeleteResult({ archived: false, deleted: true }),
    ).toStrictEqual({ kind: 'deleted', message: '帖子已删除。' });
  });

  it.each([
    null,
    {},
    { archived: true, deleted: true },
    { archived: false, deleted: false },
  ])('rejects invalid successful payloads', (payload) => {
    expect(() => parseForumDeleteResult(payload)).toThrow(
      '删除结果无效，请稍后重试。',
    );
  });
});

describe('forum comment delete results', () => {
  it('distinguishes archived and permanently deleted comment outcomes', () => {
    expect(
      parseForumCommentDeleteResult({ archived: true, deleted: false }),
    ).toStrictEqual({
      kind: 'archived',
      message: '评论有处理中举报，已归档并停止展示。',
    });
    expect(
      parseForumCommentDeleteResult({ archived: false, deleted: true }),
    ).toStrictEqual({ kind: 'deleted', message: '评论已删除。' });
  });

  it.each([
    null,
    {},
    { archived: true, deleted: true },
    { archived: false, deleted: false },
  ])('rejects invalid comment delete payloads', (payload) => {
    expect(() => parseForumCommentDeleteResult(payload)).toThrow(
      '评论删除结果无效，请稍后重试。',
    );
  });
});
