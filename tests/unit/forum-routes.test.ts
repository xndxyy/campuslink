import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  ForumConflictError,
  ForumForbiddenError,
  ForumNotFoundError,
} from '@/lib/domain/forum';
import { ContentBlockedError } from '@/lib/moderation/content-assessment';
import {
  handleForumCommentsDelete,
  handleForumCommentsGet,
  handleForumCommentsPatch,
  handleForumCommentsPost,
  handleForumLikePost,
  handleForumPostCollectionGet,
  handleForumPostCollectionPost,
  handleForumPostDetailDelete,
  handleForumPostDetailGet,
  handleForumPostDetailPatch,
} from '@/lib/domain/forum-routes';
import { MAX_JSON_BODY_BYTES } from '@/lib/security/request-body';

const user = {
  campusId: 'campus_1',
  email: 'student@example.com',
  emailVerifiedAt: new Date('2026-07-14T08:00:00Z'),
  id: 'user_1',
  name: '同学甲',
  role: 'STUDENT' as const,
  status: 'ACTIVE' as const,
};
const origin = new URL(process.env.APP_URL ?? 'http://localhost:3000').origin;

function get(path: string) {
  return new Request(`http://localhost${path}`, { method: 'GET' });
}

function mutation(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  requestOrigin = origin,
  headers: Record<string, string> = {},
) {
  return new Request(`http://localhost${path}`, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      origin: requestOrigin,
      ...headers,
    },
    method,
  });
}

describe('forum routes', () => {
  it('keeps actual Next exports fixed, dynamic, node-only, and dependency-free', () => {
    const files = [
      'app/api/forum/posts/route.ts',
      'app/api/forum/posts/[id]/route.ts',
      'app/api/forum/posts/[id]/comments/route.ts',
      'app/api/forum/posts/[id]/likes/route.ts',
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source).toContain("export const runtime = 'nodejs'");
      expect(source).toContain("export const dynamic = 'force-dynamic'");
      expect(source).not.toMatch(
        /export function (?:GET|POST|PATCH|DELETE)[\s\S]{0,160}dependencies/,
      );
    }
  });

  it('lists public discussions without resolving a user and returns no-store', async () => {
    const resolveUser = vi.fn(async () => user);
    const list = vi.fn(async () => ({ items: [], page: 2, pageSize: 10 }));
    const response = await handleForumPostCollectionGet(
      get('/api/forum/posts?view=discussion&page=2&pageSize=10&query=宿舍'),
      { list, resolveUser },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(resolveUser).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledWith(null, {
      page: 2,
      pageSize: 10,
      query: '宿舍',
      view: 'discussion',
    });
  });

  it('requires a verified ACTIVE user for tree-hole list and detail reads', async () => {
    const list = vi.fn();
    const deniedList = await handleForumPostCollectionGet(
      get('/api/forum/posts?view=tree-hole'),
      { list, resolveUser: async () => null },
    );
    expect(deniedList.status).toBe(401);
    expect(list).not.toHaveBeenCalled();

    const detail = vi.fn();
    const deniedDetail = await handleForumPostDetailGet(
      get('/api/forum/posts/tree_1?view=tree-hole'),
      'tree_1',
      {
        detail,
        resolveUser: async () => ({ ...user, emailVerifiedAt: null }),
      },
    );
    expect(deniedDetail.status).toBe(403);
    expect(detail).not.toHaveBeenCalled();
  });

  it('enforces same-origin before auth for every post mutation', async () => {
    const resolveUser = vi.fn(async () => user);
    const create = vi.fn();
    const response = await handleForumPostCollectionPost(
      mutation(
        'POST',
        '/api/forum/posts',
        {
          body: '这是一个满足长度要求的公开校园讨论正文。',
          category: 'campus-life',
          kind: 'DISCUSSION',
          title: '校园讨论主题',
        },
        'https://attacker.example',
      ),
      { create, resolveUser },
    );
    expect(response.status).toBe(403);
    expect(resolveUser).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('returns pending guidance and stable blocked-content feedback', async () => {
    const pending = await handleForumPostCollectionPost(
      mutation('POST', '/api/forum/posts', {
        body: '这是一个满足长度要求的公开校园讨论正文。',
        category: 'campus-life',
        kind: 'DISCUSSION',
        title: '校园讨论主题',
      }),
      {
        create: vi.fn(async () => ({ id: 'post_1', status: 'PENDING' })),
        resolveUser: async () => user,
      },
    );
    expect(pending.status).toBe(201);
    await expect(pending.json()).resolves.toStrictEqual({
      id: 'post_1',
      message: '内容正在人工审核。',
      status: 'PENDING',
    });

    const blocked = await handleForumCommentsPost(
      mutation('POST', '/api/forum/posts/post_1/comments', {
        body: '这是一条符合长度要求的评论。',
      }),
      'post_1',
      {
        createComment: vi.fn(async () => {
          throw new ContentBlockedError({
            categories: ['仇恨骚扰'],
            kind: 'block',
            reasonZh: '内容包含攻击性表达',
            source: 'provider',
            suggestionZh: '删除攻击性表达后重新提交',
          });
        }),
        resolveUser: async () => user,
      },
    );
    expect(blocked.status).toBe(400);
    await expect(blocked.json()).resolves.toStrictEqual({
      categories: ['仇恨骚扰'],
      code: 'CONTENT_BLOCKED',
      reason: '内容包含攻击性表达',
      suggestion: '删除攻击性表达后重新提交',
    });
  });

  it('rejects unknown create fields and oversized bounded JSON', async () => {
    const create = vi.fn();
    const unknown = await handleForumPostCollectionPost(
      mutation('POST', '/api/forum/posts', {
        body: '这是一个满足长度要求的公开校园讨论正文。',
        category: 'campus-life',
        kind: 'DISCUSSION',
        title: '校园讨论主题',
        userId: 'attacker',
      }),
      { create, resolveUser: async () => user },
    );
    expect(unknown.status).toBe(400);
    expect(create).not.toHaveBeenCalled();

    const oversized = await handleForumPostCollectionPost(
      mutation('POST', '/api/forum/posts', { body: 'x' }, origin, {
        'content-length': String(MAX_JSON_BODY_BYTES + 1),
      }),
      { create, resolveUser: async () => user },
    );
    expect(oversized.status).toBe(413);
    expect(create).not.toHaveBeenCalled();
  });

  it('supports strict owner detail update/delete without accepting kind changes', async () => {
    const update = vi.fn(async () => ({ id: 'post_1' }));
    const updated = await handleForumPostDetailPatch(
      mutation('PATCH', '/api/forum/posts/post_1?view=discussion', {
        title: '更新后的讨论标题',
      }),
      'post_1',
      { resolveUser: async () => user, update },
    );
    expect(updated.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: user.id }),
      {
        changes: { title: '更新后的讨论标题' },
        id: 'post_1',
        view: 'discussion',
      },
    );

    const rejected = await handleForumPostDetailPatch(
      mutation('PATCH', '/api/forum/posts/post_1?view=discussion', {
        kind: 'TREE_HOLE',
        title: '恶意修改',
      }),
      'post_1',
      { resolveUser: async () => user, update },
    );
    expect(rejected.status).toBe(400);

    const remove = vi.fn(async () => ({ archived: false, deleted: true }));
    const deleted = await handleForumPostDetailDelete(
      mutation('DELETE', '/api/forum/posts/post_1?view=discussion', {}),
      'post_1',
      { remove, resolveUser: async () => user },
    );
    expect(deleted.status).toBe(200);
    expect(remove).toHaveBeenCalledWith(
      expect.objectContaining({ id: user.id }),
      {
        id: 'post_1',
        view: 'discussion',
      },
    );
  });

  it('serves public comments but applies verified same-origin gates to comment writes', async () => {
    const listComments = vi.fn(async () => ({ items: [] }));
    const listed = await handleForumCommentsGet(
      get('/api/forum/posts/post_1/comments?page=1&pageSize=20'),
      'post_1',
      { listComments, resolveUser: vi.fn(async () => user) },
    );
    expect(listed.status).toBe(200);
    expect(listComments).toHaveBeenCalledWith(null, {
      page: 1,
      pageSize: 20,
      postId: 'post_1',
    });

    const createComment = vi.fn();
    const denied = await handleForumCommentsPost(
      mutation(
        'POST',
        '/api/forum/posts/post_1/comments',
        { body: '有效评论' },
        'https://attacker.example',
      ),
      'post_1',
      { createComment, resolveUser: vi.fn(async () => user) },
    );
    expect(denied.status).toBe(403);
    expect(createComment).not.toHaveBeenCalled();
  });

  it('returns the same 404 for tree-hole and unknown comment discovery without resolving auth', async () => {
    const resolveUser = vi.fn(async () => user);
    const listComments = vi.fn(async () => {
      throw new ForumNotFoundError();
    });

    const anonymousTree = await handleForumCommentsGet(
      get('/api/forum/posts/tree_1/comments'),
      'tree_1',
      { listComments, resolveUser },
    );
    const verifiedTree = await handleForumCommentsGet(
      get('/api/forum/posts/tree_1/comments'),
      'tree_1',
      { listComments, resolveUser },
    );
    const unknown = await handleForumCommentsGet(
      get('/api/forum/posts/missing_1/comments'),
      'missing_1',
      { listComments, resolveUser },
    );

    expect(anonymousTree.status).toBe(404);
    expect(verifiedTree.status).toBe(404);
    expect(unknown.status).toBe(404);
    await expect(anonymousTree.json()).resolves.toStrictEqual(
      await verifiedTree.clone().json(),
    );
    await expect(unknown.json()).resolves.toStrictEqual(
      await verifiedTree.json(),
    );
    expect(resolveUser).not.toHaveBeenCalled();
  });

  it('uses strict PATCH/DELETE comment collection bodies', async () => {
    const updateComment = vi.fn(async () => ({ id: 'comment_1' }));
    const patched = await handleForumCommentsPatch(
      mutation('PATCH', '/api/forum/posts/post_1/comments', {
        body: '更新后的评论',
        commentId: 'comment_1',
      }),
      'post_1',
      { resolveUser: async () => user, updateComment },
    );
    expect(patched.status).toBe(200);
    expect(updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ id: user.id }),
      {
        body: '更新后的评论',
        commentId: 'comment_1',
        postId: 'post_1',
      },
    );

    const removeComment = vi.fn(async () => ({ deleted: true }));
    const deleted = await handleForumCommentsDelete(
      mutation('DELETE', '/api/forum/posts/post_1/comments', {
        commentId: 'comment_1',
      }),
      'post_1',
      { removeComment, resolveUser: async () => user },
    );
    expect(deleted.status).toBe(200);

    const unknown = await handleForumCommentsDelete(
      mutation('DELETE', '/api/forum/posts/post_1/comments', {
        commentId: 'comment_1',
        userId: 'attacker',
      }),
      'post_1',
      { removeComment, resolveUser: async () => user },
    );
    expect(unknown.status).toBe(400);
  });

  it('toggles likes through an empty strict body and maps domain errors in Chinese', async () => {
    const toggleLike = vi.fn(async () => ({ liked: true, likeCount: 1 }));
    const response = await handleForumLikePost(
      mutation('POST', '/api/forum/posts/post_1/likes', {}),
      'post_1',
      { resolveUser: async () => user, toggleLike },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      liked: true,
      likeCount: 1,
    });

    const cases = [
      [new ForumForbiddenError(), 403],
      [new ForumNotFoundError(), 404],
      [new ForumConflictError(), 409],
    ] as const;
    for (const [error, status] of cases) {
      const mapped = await handleForumLikePost(
        mutation('POST', '/api/forum/posts/post_1/likes', {}),
        'post_1',
        {
          resolveUser: async () => user,
          toggleLike: vi.fn(async () => {
            throw error;
          }),
        },
      );
      expect(mapped.status).toBe(status);
      expect(await mapped.text()).toMatch(/[\u3400-\u9fff]/u);
    }
  });

  it('maps unexpected crypto/database errors without leaking details', async () => {
    const response = await handleForumPostDetailGet(
      get('/api/forum/posts/tree_1?view=tree-hole'),
      'tree_1',
      {
        detail: vi.fn(async () => {
          throw new Error('P2002 postgres secret anonymousCiphertext');
        }),
        resolveUser: async () => user,
      },
    );
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('P2002');
    expect(text).not.toContain('anonymousCiphertext');
    expect(text).not.toContain('secret');
  });

  it('maps an unrelated create P2002 to a generic 500 without retry details', async () => {
    const response = await handleForumPostCollectionPost(
      mutation('POST', '/api/forum/posts', {
        body: '这是一个满足长度要求的匿名树洞正文。',
        category: 'tree-hole',
        kind: 'TREE_HOLE',
        title: '匿名树洞主题',
      }),
      {
        create: vi.fn(async () => {
          throw {
            code: 'P2002',
            meta: { target: ['unrelated_database_unique_key'] },
          };
        }),
        resolveUser: async () => user,
      },
    );
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('P2002');
    expect(text).not.toContain('unrelated_database_unique_key');
  });
});
