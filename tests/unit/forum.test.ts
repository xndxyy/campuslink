import { describe, expect, it, vi } from 'vitest';

import {
  createForumComment,
  createForumPost,
  deleteForumComment,
  deleteForumPost,
  type ForumAdapter,
  ForumConflictError,
  ForumForbiddenError,
  ForumNotFoundError,
  ForumValidationError,
  ForumVerificationRequiredError,
  getForumPost,
  listForumComments,
  listOwnedForumPosts,
  listForumPosts,
  toggleForumLike,
  updateForumComment,
  updateForumPost,
} from '@/lib/domain/forum';
import type { AnonymousIdentityKeyring } from '@/lib/security/anonymous-identity';
import type { PreparedAssessmentBatch } from '@/lib/moderation/content-assessment';

import {
  createForumCommentSchema,
  createForumPostSchema,
  deleteForumCommentSchema,
  forumListQuerySchema,
  updateForumCommentSchema,
  updateForumPostSchema,
} from '@/lib/validation/forum';

const actor = {
  campusId: 'campus_1',
  emailVerifiedAt: new Date('2026-07-14T08:00:00Z'),
  id: 'user_1',
  role: 'STUDENT' as const,
  status: 'ACTIVE' as const,
};
const keys: AnonymousIdentityKeyring = {
  currentVersion: 1,
  encryptionKeys: new Map([[1, Buffer.alloc(32, 0x31)]]),
  fingerprintKey: Buffer.alloc(32, 0x32),
};
const createdAt = new Date('2026-07-14T09:00:00Z');

function discussionRecord(overrides: Record<string, unknown> = {}) {
  return {
    _count: { comments: 2, likes: 3 },
    author: { id: 'author_1', name: '同学甲' },
    body: '这是一个满足长度要求的公开校园讨论正文。',
    campusId: actor.campusId,
    category: 'campus-life',
    createdAt,
    id: 'post_1',
    kind: 'DISCUSSION',
    status: 'PUBLISHED',
    title: '校园讨论主题',
    updatedAt: createdAt,
    ...overrides,
  };
}

function treeHoleRecord(overrides: Record<string, unknown> = {}) {
  return {
    _count: { comments: 0, likes: 4 },
    body: '这是一个满足长度要求的匿名树洞正文。',
    campusId: actor.campusId,
    category: 'tree-hole',
    createdAt,
    id: 'tree_1',
    kind: 'TREE_HOLE',
    publicCode: 'AbCdEf123_-x',
    status: 'PUBLISHED',
    title: '匿名树洞主题',
    updatedAt: createdAt,
    ...overrides,
  };
}

function commentRecord(overrides: Record<string, unknown> = {}) {
  return {
    author: { id: actor.id, name: '当前同学' },
    authorId: actor.id,
    body: '这是一条符合长度要求的评论。',
    createdAt,
    id: 'comment_1',
    post: {
      campusId: actor.campusId,
      id: 'post_1',
      kind: 'DISCUSSION',
      status: 'PUBLISHED',
    },
    postId: 'post_1',
    status: 'PUBLISHED',
    updatedAt: createdAt,
    ...overrides,
  };
}

function forumAdapter() {
  const value = {
    $queryRawUnsafe: vi.fn(async (query: string, ...values: unknown[]) => {
      if (query.includes('FROM "ForumPost"')) {
        return [{ campusId: values[1], id: values[0] }];
      }
      if (query.includes('FROM "ForumComment"')) {
        return [{ id: values[0], postId: values[1] }];
      }
      if (query.includes('FROM "Report"')) {
        const report = await value.report.findFirst({});
        return report ? [{ ...report, commentPostId: null }] : [];
      }
      return [];
    }),
    $transaction: vi.fn(
      async (operation: (tx: ForumAdapter) => Promise<unknown>) =>
        operation(value as unknown as ForumAdapter),
    ),
    campus: {
      findFirst: vi.fn(async () => ({
        id: actor.campusId,
        isActive: true,
        slug: 'campuslink',
      })),
    },
    auditLog: { create: vi.fn(async () => ({})) },
    contentAssessment: {
      create: vi.fn(async () => ({ id: 'assessment_1' })),
    },
    forumCategory: {
      findFirst: vi.fn(async (args: Record<string, unknown>) => {
        const where = args.where as { slug: string };
        return {
          campusId: actor.campusId,
          isActive: true,
          slug: where.slug,
        };
      }),
    },
    forumComment: {
      count: vi.fn(async () => 1),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
        commentRecord(data),
      ),
      delete: vi.fn(async () => ({ id: 'comment_1' })),
      findFirst: vi.fn(async () => commentRecord()),
      findMany: vi.fn(async () => [commentRecord()]),
      update: vi.fn(async () => commentRecord()),
    },
    forumLike: {
      count: vi.fn(async () => 0),
      create: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findUnique: vi.fn(async () => null),
    },
    forumPost: {
      count: vi.fn(async () => 1),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
        data.kind === 'TREE_HOLE'
          ? treeHoleRecord(data)
          : discussionRecord(data),
      ),
      delete: vi.fn(async () => ({ id: 'post_1' })),
      findFirst: vi.fn(async () => discussionRecord()),
      findMany: vi.fn(async () => [discussionRecord()]),
      update: vi.fn(async () => discussionRecord()),
    },
    report: {
      findFirst: vi.fn(
        async (
          args?: Record<string, unknown>,
        ): Promise<Record<string, unknown> | null> => {
          void args;
          return null;
        },
      ),
    },
  };
  return value as unknown as ForumAdapter;
}

function forumPublishingPolicy(
  outcome:
    | { kind: 'pass' }
    | { kind: 'review'; reasonZh: string }
    | { kind: 'skipped' },
  targetId: string,
) {
  const skipped = outcome.kind === 'skipped';
  const prepared = {
    assessments: [
      {
        auditSkipped: skipped,
        data: {
          campusId: actor.campusId,
          decision: outcome.kind === 'review' ? 'REVIEW' : 'PASS',
          providerStatus: skipped ? 'SKIPPED' : 'COMPLETED',
          targetId,
          targetType: 'FORUM_POST',
        },
        outcome,
        targetId,
        targetType: 'FORUM_POST',
      },
    ],
    campusId: actor.campusId,
    outcome,
  } as unknown as PreparedAssessmentBatch;
  return {
    generateTargetId: () => targetId,
    prepare: vi.fn(async () => prepared),
  };
}

describe('forum validation', () => {
  it('accepts bounded plain-text discussion and tree-hole posts', () => {
    expect(
      createForumPostSchema.parse({
        body: '这是一个满足最短长度的校园讨论正文。',
        category: 'campus-life',
        kind: 'DISCUSSION',
        title: '校园讨论',
      }),
    ).toStrictEqual({
      body: '这是一个满足最短长度的校园讨论正文。',
      category: 'campus-life',
      kind: 'DISCUSSION',
      title: '校园讨论',
    });
    expect(
      createForumPostSchema.safeParse({
        body: '这是一个满足最短长度的匿名树洞正文。',
        category: 'tree-hole',
        kind: 'TREE_HOLE',
        title: '匿名树洞',
      }).success,
    ).toBe(true);
  });

  it.each([
    {
      body: '这是一个满足最短长度的校园讨论正文。',
      category: 'campus-life',
      kind: 'DISCUSSION',
      title: '校园讨论',
      userId: 'attacker',
    },
    {
      body: '<script>alert(1)</script>',
      category: 'campus-life',
      kind: 'DISCUSSION',
      title: '校园讨论',
    },
    {
      body: '这是一个满足最短长度的校园讨论正文。',
      category: 'campus-life',
      kind: 'DISCUSSION',
      title: '<img src=x onerror=alert(1)>',
    },
    {
      body: '太短',
      category: 'campus-life',
      kind: 'DISCUSSION',
      title: '校园讨论',
    },
  ])('rejects unknown fields, executable HTML, and short bodies', (input) => {
    expect(createForumPostSchema.safeParse(input).success).toBe(false);
  });

  it('prevents an update from changing kind or submitting no changes', () => {
    expect(updateForumPostSchema.safeParse({ kind: 'TREE_HOLE' }).success).toBe(
      false,
    );
    expect(updateForumPostSchema.safeParse({}).success).toBe(false);
    expect(
      updateForumPostSchema.safeParse({ title: '更新后的标题' }).success,
    ).toBe(true);
  });

  it('uses strict, bounded, stable list query semantics', () => {
    expect(
      forumListQuerySchema.parse({
        category: 'campus-life',
        page: '2',
        pageSize: '20',
        query: '宿舍',
        view: 'discussion',
      }),
    ).toStrictEqual({
      category: 'campus-life',
      page: 2,
      pageSize: 20,
      query: '宿舍',
      view: 'discussion',
    });
    expect(
      forumListQuerySchema.safeParse({
        page: '0',
        unknown: 'value',
        view: 'discussion',
      }).success,
    ).toBe(false);
    expect(
      forumListQuerySchema.safeParse({
        query: '<script>',
        view: 'discussion',
      }).success,
    ).toBe(false);
  });

  it('strictly validates comment create, update, and delete bodies', () => {
    expect(createForumCommentSchema.parse({ body: '有效评论' })).toStrictEqual({
      body: '有效评论',
    });
    expect(
      createForumCommentSchema.safeParse({ body: '<b>评论</b>' }).success,
    ).toBe(false);
    expect(
      updateForumCommentSchema.safeParse({
        body: '更新后的评论',
        commentId: 'comment_1',
        userId: 'attacker',
      }).success,
    ).toBe(false);
    expect(
      deleteForumCommentSchema.safeParse({ commentId: 'comment_1' }).success,
    ).toBe(true);
    expect(
      deleteForumCommentSchema.safeParse({
        commentId: 'comment_1',
        postId: 'other_post',
      }).success,
    ).toBe(false);
  });
});

describe('forum reads', () => {
  it('lists public discussions with author id/name and no email or anonymous fields', async () => {
    const db = forumAdapter();
    const result = await listForumPosts(db, null, {
      category: 'campus-life',
      page: 1,
      pageSize: 20,
      query: '校园',
      view: 'discussion',
    });

    expect(result).toStrictEqual({
      items: [
        {
          _count: { comments: 2, likes: 3 },
          author: { id: 'author_1', name: '同学甲' },
          body: '这是一个满足长度要求的公开校园讨论正文。',
          category: 'campus-life',
          createdAt,
          id: 'post_1',
          kind: 'DISCUSSION',
          status: 'PUBLISHED',
          title: '校园讨论主题',
          updatedAt: createdAt,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    const call = vi.mocked(db.forumPost.findMany).mock.calls[0]?.[0];
    expect(call).toEqual(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 20,
        where: expect.objectContaining({
          campusId: actor.campusId,
          category: 'campus-life',
          kind: 'DISCUSSION',
          status: 'PUBLISHED',
        }),
      }),
    );
    expect(call).toHaveProperty('select.author.select', {
      id: true,
      name: true,
    });
    expect(JSON.stringify(call)).not.toContain('email');
    expect(JSON.stringify(call)).not.toContain('anonymousCiphertext');
    expect(JSON.stringify(call)).not.toContain('anonymousFingerprint');
    expect(JSON.stringify(call)).not.toContain('anonymousKeyVersion');
  });

  it('requires a verified ACTIVE actor before any tree-hole list query', async () => {
    const db = forumAdapter();
    await expect(
      listForumPosts(
        db,
        { ...actor, emailVerifiedAt: null },
        { page: 1, pageSize: 20, view: 'tree-hole' },
      ),
    ).rejects.toBeInstanceOf(ForumVerificationRequiredError);
    expect(db.forumPost.findMany).not.toHaveBeenCalled();
  });

  it('uses a tree-hole-only select and returns only the random public code', async () => {
    const db = forumAdapter();
    vi.mocked(db.forumPost.findMany).mockResolvedValue([treeHoleRecord()]);
    const result = await listForumPosts(db, actor, {
      page: 1,
      pageSize: 20,
      view: 'tree-hole',
    });

    expect(result.items[0]).toMatchObject({
      id: 'tree_1',
      kind: 'TREE_HOLE',
      publicCode: 'AbCdEf123_-x',
    });
    expect(result.items[0]).not.toHaveProperty('author');
    expect(result.items[0]).not.toHaveProperty('authorId');
    const call = vi.mocked(db.forumPost.findMany).mock.calls[0]?.[0];
    expect(call).toHaveProperty('select.publicCode', true);
    expect(call).not.toHaveProperty('select.author');
    expect(JSON.stringify(call)).not.toContain('anonymous');
  });

  it.each([
    ['cross-campus', { campusId: 'campus_2' }],
    ['wrong kind', { kind: 'TREE_HOLE', publicCode: 'AbCdEf123_-x' }],
    ['hidden', { status: 'HIDDEN' }],
  ])('rejects defensive adapter records that are %s', async (_name, patch) => {
    const db = forumAdapter();
    vi.mocked(db.forumPost.findMany).mockResolvedValue([
      discussionRecord(patch),
    ]);
    await expect(
      listForumPosts(db, null, {
        page: 1,
        pageSize: 20,
        view: 'discussion',
      }),
    ).rejects.toBeInstanceOf(ForumNotFoundError);
  });

  it('reads a public detail without selecting email or anonymous identity', async () => {
    const db = forumAdapter();
    const result = await getForumPost(db, null, {
      id: 'post_1',
      owner: false,
      view: 'discussion',
    });
    expect(result).toStrictEqual(
      expect.objectContaining({
        author: { id: 'author_1', name: '同学甲' },
        id: 'post_1',
      }),
    );
    const call = vi.mocked(db.forumPost.findFirst).mock.calls[0]?.[0];
    expect(call).toHaveProperty('where.status', 'PUBLISHED');
    expect(JSON.stringify(call)).not.toContain('email');
    expect(JSON.stringify(call)).not.toContain('anonymousCiphertext');
  });
});

describe('forum creation', () => {
  it('publishes a passing discussion with its assessment in the same transaction', async () => {
    const db = forumAdapter();
    const policy = forumPublishingPolicy({ kind: 'pass' }, 'post_1');

    const result = await createForumPost(
      db,
      actor,
      {
        body: '这是一个满足长度要求的公开校园讨论正文。',
        category: 'campus-life',
        kind: 'DISCUSSION',
        title: '校园讨论主题',
      },
      keys,
      {},
      policy,
    );

    expect(policy.prepare).toHaveBeenCalledWith({
      campusId: actor.campusId,
      requests: [
        {
          content: {
            body: '这是一个满足长度要求的公开校园讨论正文。',
            title: '校园讨论主题',
          },
          targetId: 'post_1',
          targetType: 'FORUM_POST',
        },
      ],
    });
    expect(db.contentAssessment.create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ id: 'post_1', status: 'PUBLISHED' });
  });

  it('keeps a reviewed tree-hole pending without sending anonymous identity', async () => {
    const db = forumAdapter();
    const policy = forumPublishingPolicy(
      { kind: 'review', reasonZh: '需要人工确认树洞内容' },
      'tree_1',
    );

    const result = await createForumPost(
      db,
      actor,
      {
        body: '这是一个满足长度要求的匿名树洞正文。',
        category: 'tree-hole',
        kind: 'TREE_HOLE',
        title: '匿名树洞主题',
      },
      keys,
      { generatePublicCode: () => 'AbCdEf123_-x' },
      policy,
    );

    const serialized = JSON.stringify(policy.prepare.mock.calls);
    expect(serialized).not.toContain(actor.id);
    expect(serialized).not.toContain('anonymous');
    expect(result).toMatchObject({ id: 'tree_1', status: 'PENDING' });
    expect(result).not.toHaveProperty('authorId');
  });

  it('defensively requires a verified ACTIVE actor before querying categories', async () => {
    const db = forumAdapter();
    await expect(
      createForumPost(
        db,
        { ...actor, status: 'SUSPENDED' },
        {
          body: '这是一个满足长度要求的公开校园讨论正文。',
          category: 'campus-life',
          kind: 'DISCUSSION',
          title: '校园讨论主题',
        },
        keys,
      ),
    ).rejects.toBeInstanceOf(ForumVerificationRequiredError);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('creates an immediately PUBLISHED discussion in an active same-campus category', async () => {
    const db = forumAdapter();
    await createForumPost(
      db,
      actor,
      {
        body: '这是一个满足长度要求的公开校园讨论正文。',
        category: 'campus-life',
        kind: 'DISCUSSION',
        title: '校园讨论主题',
      },
      keys,
    );

    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(db.forumCategory.findFirst).toHaveBeenCalledWith({
      select: { campusId: true, isActive: true, slug: true },
      where: {
        campusId: actor.campusId,
        isActive: true,
        slug: 'campus-life',
      },
    });
    expect(db.forumPost.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          authorId: actor.id,
          body: '这是一个满足长度要求的公开校园讨论正文。',
          campusId: actor.campusId,
          category: 'campus-life',
          kind: 'DISCUSSION',
          status: 'PUBLISHED',
          title: '校园讨论主题',
        },
      }),
    );
    const serialized = JSON.stringify(
      vi.mocked(db.forumPost.create).mock.calls[0]?.[0],
    );
    expect(serialized).not.toContain('anonymousCiphertext');
    expect(serialized).not.toContain('anonymousFingerprint');
    expect(serialized).not.toContain('anonymousKeyVersion');
    expect(serialized).not.toContain('publicCode');
  });

  it('seals tree-hole identity and returns no secret or real user id', async () => {
    const db = forumAdapter();
    vi.mocked(db.forumPost.create).mockResolvedValue(treeHoleRecord());
    const result = await createForumPost(
      db,
      actor,
      {
        body: '这是一个满足长度要求的匿名树洞正文。',
        category: 'tree-hole',
        kind: 'TREE_HOLE',
        title: '匿名树洞主题',
      },
      keys,
      { generatePublicCode: () => 'AbCdEf123_-x' },
    );

    const create = vi.mocked(db.forumPost.create).mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
      select: Record<string, unknown>;
    };
    expect(create.data).toEqual(
      expect.objectContaining({
        anonymousCiphertext: expect.any(String),
        anonymousFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        anonymousKeyVersion: 1,
        campusId: actor.campusId,
        kind: 'TREE_HOLE',
        publicCode: 'AbCdEf123_-x',
        status: 'PUBLISHED',
      }),
    );
    expect(create.data).not.toHaveProperty('authorId');
    expect(create.select).not.toHaveProperty('anonymousCiphertext');
    expect(create.select).not.toHaveProperty('anonymousFingerprint');
    expect(create.select).not.toHaveProperty('anonymousKeyVersion');
    expect(JSON.stringify(result)).not.toContain(actor.id);
    expect(JSON.stringify(result)).not.toContain('anonymous');
  });

  it('restarts the whole transaction with a fresh random code after a collision', async () => {
    const db = forumAdapter();
    vi.mocked(db.$transaction)
      .mockImplementationOnce(async (operation) => {
        await operation(db);
        throw { code: 'P2002', meta: { target: ['publicCode'] } };
      })
      .mockImplementationOnce(async (operation) => operation(db));
    vi.mocked(db.forumPost.create).mockResolvedValue(
      treeHoleRecord({ publicCode: 'SecondCode12' }),
    );
    const codes = ['FirstCode123', 'SecondCode12'];

    await createForumPost(
      db,
      actor,
      {
        body: '这是一个满足长度要求的匿名树洞正文。',
        category: 'tree-hole',
        kind: 'TREE_HOLE',
        title: '匿名树洞主题',
      },
      keys,
      { generatePublicCode: () => codes.shift() ?? 'NoMoreCodes1' },
    );

    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.forumPost.create).toHaveBeenCalledTimes(2);
    expect(db.forumPost.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ publicCode: 'SecondCode12' }),
      }),
    );
  });

  it('maps exhausted public-code collisions to a safe conflict', async () => {
    const db = forumAdapter();
    vi.mocked(db.$transaction).mockRejectedValue({
      code: 'P2002',
      detail: 'anonymous secret',
      meta: { target: ['publicCode'] },
    });
    await expect(
      createForumPost(
        db,
        actor,
        {
          body: '这是一个满足长度要求的匿名树洞正文。',
          category: 'tree-hole',
          kind: 'TREE_HOLE',
          title: '匿名树洞主题',
        },
        keys,
      ),
    ).rejects.toEqual(new ForumConflictError());
    expect(db.$transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry or remap an unrelated P2002 during tree-hole creation', async () => {
    const db = forumAdapter();
    const unrelated = {
      code: 'P2002',
      meta: { target: ['ForumCategory_campusId_slug_key'] },
    };
    vi.mocked(db.$transaction).mockRejectedValue(unrelated);
    await expect(
      createForumPost(
        db,
        actor,
        {
          body: '这是一个满足长度要求的匿名树洞正文。',
          category: 'tree-hole',
          kind: 'TREE_HOLE',
          title: '匿名树洞主题',
        },
        keys,
      ),
    ).rejects.toBe(unrelated);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('forum owner management', () => {
  it.each(['HIDDEN', 'ARCHIVED'] as const)(
    'does not let an owner republish a moderator-controlled %s post by editing it',
    async (status) => {
      const db = forumAdapter();
      const policy = forumPublishingPolicy({ kind: 'pass' }, 'post_1');
      vi.mocked(db.forumPost.findFirst).mockResolvedValue(
        discussionRecord({ authorId: actor.id, status }),
      );

      await expect(
        updateForumPost(
          db,
          actor,
          {
            changes: { title: '试图重新公开的标题' },
            id: 'post_1',
            view: 'discussion',
          },
          keys,
          policy,
        ),
      ).rejects.toBeInstanceOf(ForumConflictError);
      expect(policy.prepare).not.toHaveBeenCalled();
      expect(db.forumPost.update).not.toHaveBeenCalled();
    },
  );

  it('reassesses the complete post when an owner edits public content', async () => {
    const db = forumAdapter();
    const policy = forumPublishingPolicy(
      { kind: 'review', reasonZh: '编辑内容需要人工确认' },
      'post_1',
    );
    vi.mocked(db.forumPost.findFirst).mockResolvedValue(
      discussionRecord({ authorId: actor.id }),
    );
    vi.mocked(db.forumPost.update).mockImplementation(
      async (args: Record<string, unknown>) =>
        discussionRecord({
          authorId: actor.id,
          ...((args.data as Record<string, unknown>) ?? {}),
        }),
    );

    const result = await updateForumPost(
      db,
      actor,
      {
        changes: { title: '更新后的校园讨论标题' },
        id: 'post_1',
        view: 'discussion',
      },
      keys,
      policy,
    );

    expect(policy.prepare).toHaveBeenCalledWith({
      campusId: actor.campusId,
      requests: [
        {
          content: {
            body: '这是一个满足长度要求的公开校园讨论正文。',
            title: '更新后的校园讨论标题',
          },
          targetId: 'post_1',
          targetType: 'FORUM_POST',
        },
      ],
    });
    expect(db.forumPost.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING' }),
      }),
    );
    expect(result).toMatchObject({ id: 'post_1', status: 'PENDING' });
  });

  it('lists owned discussion and tree-hole posts without selecting anonymous secrets', async () => {
    const db = forumAdapter();
    vi.mocked(db.forumPost.findMany)
      .mockResolvedValueOnce([
        discussionRecord({ authorId: undefined, status: 'HIDDEN' }),
      ])
      .mockResolvedValueOnce([
        treeHoleRecord({ anonymousFingerprint: undefined, status: 'ARCHIVED' }),
      ]);

    const result = await listOwnedForumPosts(db, actor, keys);

    expect(result.discussions[0]).toMatchObject({
      id: 'post_1',
      status: 'HIDDEN',
    });
    expect(result.treeHoles[0]).toMatchObject({
      id: 'tree_1',
      publicCode: 'AbCdEf123_-x',
      status: 'ARCHIVED',
    });
    const calls = vi.mocked(db.forumPost.findMany).mock.calls;
    expect(calls[0]?.[0]).toHaveProperty('where.authorId', actor.id);
    expect(calls[0]?.[0]).toHaveProperty(
      'where.ownerDeletionRequestedAt',
      null,
    );
    expect(calls[1]?.[0]).toHaveProperty(
      'where.anonymousFingerprint',
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(calls[1]?.[0]).toHaveProperty(
      'where.ownerDeletionRequestedAt',
      null,
    );
    for (const call of calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain('anonymousCiphertext');
      expect(serialized).not.toContain('anonymousKeyVersion');
      expect(call[0]).not.toHaveProperty('select.authorId');
      expect(call[0]).not.toHaveProperty('select.anonymousFingerprint');
    }
    expect(JSON.stringify(result)).not.toContain(actor.id);
    expect(JSON.stringify(result)).not.toContain('anonymous');
  });

  it('rejects an invalid direct domain view before database access', async () => {
    const db = forumAdapter();
    await expect(
      getForumPost(db, null, {
        id: 'post_1',
        owner: false,
        view: 'forged-view' as never,
      }),
    ).rejects.toBeInstanceOf(ForumValidationError);
    expect(db.campus.findFirst).not.toHaveBeenCalled();
    expect(db.forumPost.findFirst).not.toHaveBeenCalled();
  });

  it('shows a hidden discussion only through a verified owner lookup', async () => {
    const db = forumAdapter();
    vi.mocked(db.forumPost.findFirst).mockResolvedValue(
      discussionRecord({ authorId: actor.id, status: 'HIDDEN' }),
    );

    const result = await getForumPost(
      db,
      actor,
      { id: 'post_1', owner: true, view: 'discussion' },
      keys,
    );

    expect(result).toMatchObject({ id: 'post_1', status: 'HIDDEN' });
    expect(db.forumPost.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ authorId: true }),
        where: expect.objectContaining({
          authorId: actor.id,
          campusId: actor.campusId,
          id: 'post_1',
          kind: 'DISCUSSION',
        }),
      }),
    );
    expect(result).not.toHaveProperty('authorId');
  });

  it('matches tree-hole ownership by HMAC fingerprint without selecting ciphertext', async () => {
    const db = forumAdapter();
    const fingerprint = 'd'.repeat(64);
    const fingerprintKey = Buffer.alloc(32, 0x32);
    const ownerKeys = { ...keys, fingerprintKey };
    const { createHmac } = await import('node:crypto');
    const expected = createHmac('sha256', fingerprintKey)
      .update(actor.id, 'utf8')
      .digest('hex');
    vi.mocked(db.forumPost.findFirst).mockResolvedValue(
      treeHoleRecord({
        anonymousFingerprint: expected,
        status: 'HIDDEN',
      }),
    );

    const result = await getForumPost(
      db,
      actor,
      { id: 'tree_1', owner: true, view: 'tree-hole' },
      ownerKeys,
    );

    expect(result).toMatchObject({ id: 'tree_1', status: 'HIDDEN' });
    expect(result).not.toHaveProperty('anonymousFingerprint');
    const call = vi.mocked(db.forumPost.findFirst).mock.calls[0]?.[0];
    expect(call).toHaveProperty('select.anonymousFingerprint', true);
    expect(JSON.stringify(call)).not.toContain('anonymousCiphertext');
    expect(JSON.stringify(call)).not.toContain('anonymousKeyVersion');
    expect(JSON.stringify(call)).not.toContain('authorId');
    expect(JSON.stringify(result)).not.toContain(fingerprint);
    expect(JSON.stringify(result)).not.toContain(actor.id);
  });

  it('rejects a defensive owner record from another campus', async () => {
    const db = forumAdapter();
    vi.mocked(db.forumPost.findFirst).mockResolvedValue(
      discussionRecord({ authorId: actor.id, campusId: 'campus_2' }),
    );
    await expect(
      getForumPost(
        db,
        actor,
        { id: 'post_1', owner: true, view: 'discussion' },
        keys,
      ),
    ).rejects.toBeInstanceOf(ForumNotFoundError);
  });

  it('updates only an owned post and validates a changed active category', async () => {
    const db = forumAdapter();
    vi.mocked(db.forumPost.findFirst).mockResolvedValue(
      discussionRecord({ authorId: actor.id }),
    );
    vi.mocked(db.forumPost.update).mockResolvedValue(
      discussionRecord({
        authorId: actor.id,
        category: 'study',
        title: '更新后的讨论标题',
      }),
    );

    const result = await updateForumPost(
      db,
      actor,
      {
        changes: { category: 'study', title: '更新后的讨论标题' },
        id: 'post_1',
        view: 'discussion',
      },
      keys,
    );

    expect(db.forumCategory.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ slug: 'study' }),
      }),
    );
    expect(db.forumPost.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { category: 'study', title: '更新后的讨论标题' },
        where: { id: 'post_1' },
      }),
    );
    expect(result).toMatchObject({
      category: 'study',
      id: 'post_1',
      title: '更新后的讨论标题',
    });
  });

  it("rejects editing another user's discussion before update", async () => {
    const db = forumAdapter();
    vi.mocked(db.forumPost.findFirst).mockResolvedValue(
      discussionRecord({ authorId: 'other_user' }),
    );
    await expect(
      updateForumPost(
        db,
        actor,
        {
          changes: { title: '不能修改的标题' },
          id: 'post_1',
          view: 'discussion',
        },
        keys,
      ),
    ).rejects.toBeInstanceOf(ForumForbiddenError);
    expect(db.forumPost.update).not.toHaveBeenCalled();
  });

  it.each(['OPEN', 'TRIAGED'] as const)(
    'archives an owned post instead of deleting evidence for a %s report',
    async (status) => {
      const db = forumAdapter();
      vi.mocked(db.forumPost.findFirst).mockResolvedValue(
        discussionRecord({ authorId: actor.id }),
      );
      vi.mocked(db.report.findFirst).mockResolvedValue({
        campusId: actor.campusId,
        id: 'report_1',
        status,
        targetId: 'post_1',
        targetType: 'FORUM_POST',
      });
      vi.mocked(db.forumPost.update).mockResolvedValue(
        discussionRecord({ authorId: actor.id, status: 'ARCHIVED' }),
      );

      await expect(
        deleteForumPost(db, actor, { id: 'post_1', view: 'discussion' }, keys),
      ).resolves.toStrictEqual({
        archived: true,
        deleted: false,
        id: 'post_1',
      });
      expect(db.forumPost.update).toHaveBeenCalledWith({
        data: {
          ownerDeletionRequestedAt: expect.any(Date),
          status: 'ARCHIVED',
        },
        select: { id: true },
        where: { id: 'post_1' },
      });
      expect(db.forumPost.delete).not.toHaveBeenCalled();
    },
  );

  it('archives a post when an active report targets a descendant comment', async () => {
    const db = forumAdapter();
    vi.mocked(db.forumPost.findFirst).mockResolvedValue(
      discussionRecord({ authorId: actor.id }),
    );
    vi.mocked(db.$queryRawUnsafe).mockImplementation(
      async (query: string, ...values: unknown[]) => {
        if (query.includes('FROM "ForumPost"')) {
          return [{ campusId: values[1], id: values[0] }];
        }
        return [
          {
            campusId: actor.campusId,
            commentPostId: 'post_1',
            id: 'report_1',
            status: 'OPEN',
            targetId: 'comment_1',
            targetType: 'FORUM_COMMENT',
          },
        ];
      },
    );
    vi.mocked(db.forumPost.update).mockResolvedValue({ id: 'post_1' });

    await expect(
      deleteForumPost(db, actor, { id: 'post_1', view: 'discussion' }, keys),
    ).resolves.toStrictEqual({
      archived: true,
      deleted: false,
      id: 'post_1',
    });
    expect(db.forumPost.delete).not.toHaveBeenCalled();
    expect(db.$queryRawUnsafe).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM "Report"'),
      actor.campusId,
      'post_1',
    );
  });

  it('locks the post FOR UPDATE before ownership and rejects an absent lock row', async () => {
    const db = forumAdapter();
    vi.mocked(db.$queryRawUnsafe).mockResolvedValueOnce([]);

    await expect(
      deleteForumPost(db, actor, { id: 'post_1', view: 'discussion' }, keys),
    ).rejects.toBeInstanceOf(ForumNotFoundError);
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      'post_1',
      actor.campusId,
    );
    expect(db.forumPost.findFirst).not.toHaveBeenCalled();
  });

  it('rejects forged descendant evidence instead of deleting the post', async () => {
    const db = forumAdapter();
    vi.mocked(db.forumPost.findFirst).mockResolvedValue(
      discussionRecord({ authorId: actor.id }),
    );
    vi.mocked(db.$queryRawUnsafe).mockImplementation(
      async (query: string, ...values: unknown[]) =>
        query.includes('FROM "ForumPost"')
          ? [{ campusId: values[1], id: values[0] }]
          : [
              {
                campusId: 'campus_2',
                commentPostId: 'post_1',
                id: 'report_1',
                status: 'OPEN',
                targetId: 'comment_1',
                targetType: 'FORUM_COMMENT',
              },
            ],
    );
    await expect(
      deleteForumPost(db, actor, { id: 'post_1', view: 'discussion' }, keys),
    ).rejects.toBeInstanceOf(ForumConflictError);
    expect(db.forumPost.delete).not.toHaveBeenCalled();
  });

  it('physically deletes an owned post only when no active report exists', async () => {
    const db = forumAdapter();
    vi.mocked(db.forumPost.findFirst).mockResolvedValue(
      discussionRecord({ authorId: actor.id }),
    );
    await expect(
      deleteForumPost(db, actor, { id: 'post_1', view: 'discussion' }, keys),
    ).resolves.toStrictEqual({
      archived: false,
      deleted: true,
      id: 'post_1',
    });
    expect(db.forumPost.delete).toHaveBeenCalledWith({
      select: { id: true },
      where: { id: 'post_1' },
    });
  });

  it('retries the entire evidence decision after a serialization failure', async () => {
    const db = forumAdapter();
    vi.mocked(db.forumPost.findFirst).mockResolvedValue(
      discussionRecord({ authorId: actor.id }),
    );
    vi.mocked(db.$transaction)
      .mockImplementationOnce(async (operation) => {
        await operation(db);
        throw { code: 'P2034' };
      })
      .mockImplementationOnce(async (operation) => operation(db));
    await deleteForumPost(
      db,
      actor,
      { id: 'post_1', view: 'discussion' },
      keys,
    );
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.report.findFirst).toHaveBeenCalledTimes(2);
    const lockCalls = vi
      .mocked(db.$queryRawUnsafe)
      .mock.calls.filter(([query]) => String(query).includes('FOR UPDATE'));
    expect(lockCalls).toHaveLength(2);
  });
});

describe('forum comments', () => {
  it('keeps a reviewed discussion comment pending', async () => {
    const db = forumAdapter();
    const policy = forumPublishingPolicy(
      { kind: 'review', reasonZh: '需要人工确认评论内容' },
      'comment_1',
    );

    const result = await createForumComment(
      db,
      actor,
      { body: '这是一条需要审核的有效评论。', postId: 'post_1' },
      policy,
    );

    expect(policy.prepare).toHaveBeenCalledWith({
      campusId: actor.campusId,
      requests: [
        {
          content: { comment: '这是一条需要审核的有效评论。' },
          targetId: 'comment_1',
          targetType: 'FORUM_COMMENT',
        },
      ],
    });
    expect(result).toMatchObject({ id: 'comment_1', status: 'PENDING' });
  });

  it('reassesses a comment edit before keeping it public', async () => {
    const db = forumAdapter();
    const policy = forumPublishingPolicy({ kind: 'pass' }, 'comment_1');
    vi.mocked(db.forumComment.update).mockImplementation(
      async (args: Record<string, unknown>) =>
        commentRecord((args.data as Record<string, unknown>) ?? {}),
    );

    const result = await updateForumComment(
      db,
      actor,
      {
        body: '更新后的合规评论内容。',
        commentId: 'comment_1',
        postId: 'post_1',
      },
      policy,
    );

    expect(policy.prepare).toHaveBeenCalledWith({
      campusId: actor.campusId,
      requests: [
        {
          content: { comment: '更新后的合规评论内容。' },
          targetId: 'comment_1',
          targetType: 'FORUM_COMMENT',
        },
      ],
    });
    expect(db.forumComment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { body: '更新后的合规评论内容。', status: 'PUBLISHED' },
      }),
    );
    expect(result).toMatchObject({ status: 'PUBLISHED' });
  });

  it.each(['HIDDEN', 'ARCHIVED'] as const)(
    'does not let an author republish a moderator-controlled %s comment by editing it',
    async (status) => {
      const db = forumAdapter();
      const policy = forumPublishingPolicy({ kind: 'pass' }, 'comment_1');
      vi.mocked(db.forumComment.findFirst).mockResolvedValue(
        commentRecord({ status }),
      );

      await expect(
        updateForumComment(
          db,
          actor,
          {
            body: '试图重新公开的评论内容。',
            commentId: 'comment_1',
            postId: 'post_1',
          },
          policy,
        ),
      ).rejects.toBeInstanceOf(ForumConflictError);
      expect(policy.prepare).not.toHaveBeenCalled();
      expect(db.forumComment.update).not.toHaveBeenCalled();
    },
  );

  it('discovers comments through a discussion-only query and hides forged tree-hole records', async () => {
    const db = forumAdapter();
    vi.mocked(db.forumPost.findFirst).mockResolvedValue(treeHoleRecord());

    await expect(
      listForumComments(db, null, {
        page: 1,
        pageSize: 20,
        postId: 'tree_1',
      }),
    ).rejects.toBeInstanceOf(ForumNotFoundError);

    expect(db.forumPost.findFirst).toHaveBeenCalledWith({
      select: {
        campusId: true,
        id: true,
        kind: true,
        status: true,
      },
      where: {
        campusId: actor.campusId,
        id: 'tree_1',
        kind: 'DISCUSSION',
        status: 'PUBLISHED',
      },
    });
    expect(db.forumComment.findMany).not.toHaveBeenCalled();
  });

  it('lists one-level public discussion comments with author id/name only', async () => {
    const db = forumAdapter();
    const result = await listForumComments(db, null, {
      page: 1,
      pageSize: 20,
      postId: 'post_1',
    });

    expect(result).toStrictEqual({
      items: [
        {
          author: { id: actor.id, name: '当前同学' },
          body: '这是一条符合长度要求的评论。',
          createdAt,
          id: 'comment_1',
          postId: 'post_1',
          status: 'PUBLISHED',
          updatedAt: createdAt,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    const call = vi.mocked(db.forumComment.findMany).mock.calls[0]?.[0];
    expect(call).toHaveProperty('select.author.select', {
      id: true,
      name: true,
    });
    expect(JSON.stringify(call)).not.toContain('email');
    expect(JSON.stringify(result)).not.toContain('authorId');
  });

  it('requires verified ACTIVE actors for comment writes before database access', async () => {
    const db = forumAdapter();
    await expect(
      createForumComment(
        db,
        { ...actor, emailVerifiedAt: null },
        { body: '有效评论', postId: 'post_1' },
      ),
    ).rejects.toBeInstanceOf(ForumVerificationRequiredError);
    expect(db.forumPost.findFirst).not.toHaveBeenCalled();
  });

  it('hides a visible tree-hole behind the same not-found comment boundary', async () => {
    const db = forumAdapter();
    vi.mocked(db.forumPost.findFirst).mockResolvedValue(
      treeHoleRecord({ _count: undefined }),
    );
    await expect(
      createForumComment(db, actor, {
        body: '不应允许的评论',
        postId: 'tree_1',
      }),
    ).rejects.toBeInstanceOf(ForumNotFoundError);
    expect(db.forumComment.create).not.toHaveBeenCalled();
  });

  it('creates a published comment on a visible same-campus discussion', async () => {
    const db = forumAdapter();
    const result = await createForumComment(db, actor, {
      body: '有效评论',
      postId: 'post_1',
    });
    expect(db.forumComment.create).toHaveBeenCalledWith({
      data: {
        authorId: actor.id,
        body: '有效评论',
        postId: 'post_1',
        status: 'PUBLISHED',
      },
      select: expect.objectContaining({
        author: { select: { id: true, name: true } },
      }),
    });
    expect(result).not.toHaveProperty('authorId');
  });

  it('allows a comment author to update and delete through the collection service', async () => {
    const db = forumAdapter();
    vi.mocked(db.forumComment.update).mockResolvedValue(
      commentRecord({ body: '更新后的评论' }),
    );
    await expect(
      updateForumComment(db, actor, {
        body: '更新后的评论',
        commentId: 'comment_1',
        postId: 'post_1',
      }),
    ).resolves.toMatchObject({ body: '更新后的评论', id: 'comment_1' });
    expect(db.forumComment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { body: '更新后的评论' },
        where: { id: 'comment_1' },
      }),
    );

    await expect(
      deleteForumComment(db, actor, {
        commentId: 'comment_1',
        postId: 'post_1',
      }),
    ).resolves.toStrictEqual({
      archived: false,
      deleted: true,
      id: 'comment_1',
    });
    expect(db.$queryRawUnsafe).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FOR KEY SHARE'),
      'post_1',
      actor.campusId,
    );
    expect(db.$queryRawUnsafe).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FOR UPDATE'),
      'comment_1',
      'post_1',
    );
    expect(
      vi.mocked(db.$queryRawUnsafe).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(db.forumComment.findFirst).mock.invocationCallOrder[1] ??
        Number.POSITIVE_INFINITY,
    );
  });

  it('rejects defensive comments owned by another user', async () => {
    const db = forumAdapter();
    vi.mocked(db.forumComment.findFirst).mockResolvedValue(
      commentRecord({ authorId: 'other_user' }),
    );
    await expect(
      updateForumComment(db, actor, {
        body: '不能更新的评论',
        commentId: 'comment_1',
        postId: 'post_1',
      }),
    ).rejects.toBeInstanceOf(ForumForbiddenError);
    expect(db.forumComment.update).not.toHaveBeenCalled();
  });

  it('rejects comment deletion when the parent lock row is absent', async () => {
    const db = forumAdapter();
    vi.mocked(db.$queryRawUnsafe).mockResolvedValueOnce([]);
    await expect(
      deleteForumComment(db, actor, {
        commentId: 'comment_1',
        postId: 'post_1',
      }),
    ).rejects.toBeInstanceOf(ForumNotFoundError);
    expect(db.forumComment.findFirst).not.toHaveBeenCalled();
    expect(db.forumComment.delete).not.toHaveBeenCalled();
  });

  it('reacquires parent and comment locks after a comment-delete serialization retry', async () => {
    const db = forumAdapter();
    vi.mocked(db.$transaction)
      .mockImplementationOnce(async (operation) => {
        await operation(db);
        throw { meta: { code: '40001' } };
      })
      .mockImplementationOnce(async (operation) => operation(db));
    await deleteForumComment(db, actor, {
      commentId: 'comment_1',
      postId: 'post_1',
    });
    const parentLocks = vi
      .mocked(db.$queryRawUnsafe)
      .mock.calls.filter(([query]) => String(query).includes('FOR KEY SHARE'));
    const commentLocks = vi
      .mocked(db.$queryRawUnsafe)
      .mock.calls.filter(([query]) => String(query).includes('FOR UPDATE'));
    expect(parentLocks).toHaveLength(2);
    expect(commentLocks).toHaveLength(2);
  });

  it('rejects hidden discussion records before creating interactions', async () => {
    const db = forumAdapter();
    vi.mocked(db.forumPost.findFirst).mockResolvedValue(
      discussionRecord({ status: 'HIDDEN' }),
    );
    await expect(
      createForumComment(db, actor, {
        body: '有效评论',
        postId: 'post_1',
      }),
    ).rejects.toBeInstanceOf(ForumNotFoundError);
    expect(db.forumComment.create).not.toHaveBeenCalled();
  });
});

describe('forum likes', () => {
  it('toggles a visible discussion like and returns only state/count', async () => {
    const db = forumAdapter();
    vi.mocked(db.forumLike.create).mockResolvedValue({
      id: 'like_1',
      postId: 'post_1',
      userId: actor.id,
    });
    vi.mocked(db.forumLike.count).mockResolvedValue(4);
    await expect(
      toggleForumLike(db, actor, { postId: 'post_1' }),
    ).resolves.toStrictEqual({ liked: true, likeCount: 4 });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('removes an existing like idempotently inside the transaction', async () => {
    const db = forumAdapter();
    vi.mocked(db.forumLike.findUnique).mockResolvedValue({
      id: 'like_1',
      postId: 'post_1',
      userId: actor.id,
    });
    vi.mocked(db.forumLike.deleteMany).mockResolvedValue({ count: 1 });
    vi.mocked(db.forumLike.count).mockResolvedValue(3);
    await expect(
      toggleForumLike(db, actor, { postId: 'post_1' }),
    ).resolves.toStrictEqual({ liked: false, likeCount: 3 });
    expect(db.forumLike.create).not.toHaveBeenCalled();
  });

  it('retries the whole toggle after a unique race and converges on reread state', async () => {
    const db = forumAdapter();
    vi.mocked(db.forumLike.create).mockResolvedValue({
      id: 'like_1',
      postId: 'post_1',
      userId: actor.id,
    });
    vi.mocked(db.$transaction)
      .mockImplementationOnce(async (operation) => {
        await operation(db);
        throw {
          code: 'P2002',
          meta: { target: ['userId', 'postId'] },
        };
      })
      .mockImplementationOnce(async (operation) => {
        vi.mocked(db.forumLike.findUnique).mockResolvedValue({
          id: 'like_1',
          postId: 'post_1',
          userId: actor.id,
        });
        vi.mocked(db.forumLike.deleteMany).mockResolvedValue({ count: 1 });
        return operation(db);
      });

    await expect(
      toggleForumLike(db, actor, { postId: 'post_1' }),
    ).resolves.toStrictEqual({ liked: false, likeCount: 0 });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.forumPost.findFirst).toHaveBeenCalledTimes(2);
  });

  it('does not retry or map an unrelated like P2002', async () => {
    const db = forumAdapter();
    const unrelated = {
      code: 'P2002',
      meta: { target: ['ForumPost_publicCode_key'] },
    };
    vi.mocked(db.$transaction).mockRejectedValue(unrelated);
    await expect(toggleForumLike(db, actor, { postId: 'post_1' })).rejects.toBe(
      unrelated,
    );
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    { code: 'P2034' },
    { code: '40001' },
    { meta: { code: '40001' } },
    {
      code: 'P2010',
      meta: {
        driverAdapterError: {
          cause: { originalCode: '40001' },
        },
      },
    },
    {
      cause: {
        kind: 'TransactionWriteConflict',
        originalCode: '40001',
      },
      name: 'DriverAdapterError',
    },
  ])('always retries serialization failures %#', async (failure) => {
    const db = forumAdapter();
    vi.mocked(db.forumLike.create).mockResolvedValue({
      id: 'like_1',
      postId: 'post_1',
      userId: actor.id,
    });
    vi.mocked(db.$transaction)
      .mockRejectedValueOnce(failure)
      .mockImplementationOnce(async (operation) => operation(db));
    await expect(
      toggleForumLike(db, actor, { postId: 'post_1' }),
    ).resolves.toStrictEqual({ liked: true, likeCount: 0 });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });

  it('allows likes on tree-hole posts without exposing identity or like users', async () => {
    const db = forumAdapter();
    vi.mocked(db.forumPost.findFirst).mockResolvedValue(treeHoleRecord());
    vi.mocked(db.forumLike.create).mockResolvedValue({
      id: 'like_1',
      postId: 'tree_1',
      userId: actor.id,
    });
    const result = await toggleForumLike(db, actor, { postId: 'tree_1' });
    expect(result).toStrictEqual({ liked: true, likeCount: 0 });
    expect(JSON.stringify(result)).not.toContain(actor.id);
  });
});
