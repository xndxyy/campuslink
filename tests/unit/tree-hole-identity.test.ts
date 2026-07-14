import { describe, expect, it, vi } from 'vitest';

import * as treeHoleIdentityRoute from '@/app/api/admin/tree-hole-identity/route';
import {
  revealTreeHoleAuthor,
  TreeHoleIdentityForbiddenError,
  TreeHoleIdentityValidationError,
  type TreeHoleIdentityAdapter,
} from '@/lib/domain/tree-hole-identity';
import {
  AnonymousIdentityError,
  sealAnonymousIdentity,
  serializeAnonymousIdentityEnvelope,
  type AnonymousIdentityKeyring,
} from '@/lib/security/anonymous-identity';

const keys: AnonymousIdentityKeyring = {
  currentVersion: 1,
  encryptionKeys: new Map([
    [1, Buffer.alloc(32, 0x51)],
    [2, Buffer.alloc(32, 0x52)],
  ]),
  fingerprintKey: Buffer.alloc(32, 0x53),
};
const actor = {
  campusId: 'campus_1',
  id: 'admin_1',
  role: 'ADMIN' as const,
};
const input = {
  postId: 'post_1',
  reason: 'Required to investigate a credible safety report.',
  reportId: 'report_1',
};

function adapter(
  options: {
    post?: Record<string, unknown> | null;
    report?: Record<string, unknown> | null;
  } = {},
) {
  const order: string[] = [];
  const envelope = sealAnonymousIdentity('private_user_1', keys);
  const value = {
    $transaction: vi.fn(
      async (operation: (tx: TreeHoleIdentityAdapter) => Promise<unknown>) => {
        order.push('transaction');
        return operation(value as unknown as TreeHoleIdentityAdapter);
      },
    ),
    auditLog: {
      create: vi.fn(async ({ data }) => {
        order.push('audit');
        return { id: 'audit_1', ...data };
      }),
    },
    forumPost: {
      findFirst: vi.fn(async () => {
        order.push('post');
        return options.post === undefined
          ? {
              anonymousCiphertext: serializeAnonymousIdentityEnvelope(envelope),
              anonymousKeyVersion: 1,
              campusId: actor.campusId,
              id: input.postId,
              kind: 'TREE_HOLE',
            }
          : options.post;
      }),
    },
    report: {
      findFirst: vi.fn(async () => {
        order.push('report');
        return options.report === undefined
          ? {
              campusId: actor.campusId,
              id: input.reportId,
              status: 'OPEN',
              targetId: input.postId,
              targetType: 'FORUM_POST',
            }
          : options.report;
      }),
    },
    order,
  };
  return value as unknown as TreeHoleIdentityAdapter & { order: string[] };
}

describe('audited tree-hole identity reveal', () => {
  it('denies moderators in the domain before opening a transaction', async () => {
    const db = adapter();

    await expect(
      revealTreeHoleAuthor(db, { ...actor, role: 'MODERATOR' }, input, keys),
    ).rejects.toBeInstanceOf(TreeHoleIdentityForbiddenError);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.report.findFirst).not.toHaveBeenCalled();
    expect(db.forumPost.findFirst).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(['RESOLVED', 'DISMISSED'] as const)(
    'denies an inactive %s report before selecting identity fields',
    async (status) => {
      const db = adapter({
        report: {
          campusId: actor.campusId,
          id: input.reportId,
          status,
          targetId: input.postId,
          targetType: 'FORUM_POST',
        },
      });

      await expect(
        revealTreeHoleAuthor(db, actor, input, keys),
      ).rejects.toBeInstanceOf(TreeHoleIdentityForbiddenError);
      expect(db.order).toEqual(['transaction', 'report']);
      expect(db.forumPost.findFirst).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    },
  );

  it('denies a missing active report with a campus-scoped exact target query', async () => {
    const db = adapter({ report: null });

    await expect(
      revealTreeHoleAuthor(db, actor, input, keys),
    ).rejects.toBeInstanceOf(TreeHoleIdentityForbiddenError);
    expect(db.report.findFirst).toHaveBeenCalledWith({
      select: {
        campusId: true,
        id: true,
        status: true,
        targetId: true,
        targetType: true,
      },
      where: {
        campusId: actor.campusId,
        id: input.reportId,
        status: { in: ['OPEN', 'TRIAGED'] },
        targetId: input.postId,
        targetType: 'FORUM_POST',
      },
    });
    expect(db.forumPost.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['cross-campus report', { campusId: 'campus_2' }],
    ['target mismatch', { targetId: 'post_2' }],
    ['target type mismatch', { targetType: 'FORUM_COMMENT' }],
  ])('defensively rejects a returned %s', async (_, override) => {
    const db = adapter({
      report: {
        campusId: actor.campusId,
        id: input.reportId,
        status: 'TRIAGED',
        targetId: input.postId,
        targetType: 'FORUM_POST',
        ...override,
      },
    });

    await expect(
      revealTreeHoleAuthor(db, actor, input, keys),
    ).rejects.toBeInstanceOf(TreeHoleIdentityForbiddenError);
    expect(db.forumPost.findFirst).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong post kind', { kind: 'DISCUSSION' }],
    ['cross-campus post', { campusId: 'campus_2' }],
    ['post mismatch', { id: 'post_2' }],
  ])('denies a %s without writing an audit', async (_, override) => {
    const envelope = sealAnonymousIdentity('private_user_1', keys);
    const db = adapter({
      post: {
        anonymousCiphertext: serializeAnonymousIdentityEnvelope(envelope),
        anonymousKeyVersion: 1,
        campusId: actor.campusId,
        id: input.postId,
        kind: 'TREE_HOLE',
        ...override,
      },
    });

    await expect(
      revealTreeHoleAuthor(db, actor, input, keys),
    ).rejects.toBeInstanceOf(TreeHoleIdentityForbiddenError);
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('reveals only userId and writes a minimal audit in one Serializable transaction', async () => {
    const db = adapter();

    const result = await revealTreeHoleAuthor(
      db,
      actor,
      { ...input, reason: `  ${input.reason}  ` },
      keys,
    );
    db.order.push('response');

    expect(result).toStrictEqual({ userId: 'private_user_1' });
    expect(db.order).toEqual([
      'transaction',
      'report',
      'post',
      'audit',
      'response',
    ]);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(db.forumPost.findFirst).toHaveBeenCalledWith({
      select: {
        anonymousCiphertext: true,
        anonymousKeyVersion: true,
        campusId: true,
        id: true,
        kind: true,
      },
      where: {
        campusId: actor.campusId,
        id: input.postId,
        kind: 'TREE_HOLE',
      },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: 'TREE_HOLE_AUTHOR_REVEALED',
        actorId: actor.id,
        campusId: actor.campusId,
        details: {
          postId: input.postId,
          reason: input.reason,
          reportId: input.reportId,
        },
        subjectId: input.reportId,
        subjectType: 'REPORT',
      },
      select: { id: true },
    });
    const auditCall = JSON.stringify(vi.mocked(db.auditLog.create).mock.calls);
    for (const secret of [
      'private_user_1',
      'anonymousCiphertext',
      'anonymousFingerprint',
      'anonymousKeyVersion',
      'ciphertext',
      'fingerprint',
      'iv',
      'tag',
      'email',
    ]) {
      expect(auditCall).not.toContain(secret);
    }
  });

  it.each(['OPEN', 'TRIAGED'] as const)(
    'accepts an active %s report',
    async (status) => {
      const db = adapter({
        report: {
          campusId: actor.campusId,
          id: input.reportId,
          status,
          targetId: input.postId,
          targetType: 'FORUM_POST',
        },
      });

      await expect(
        revealTreeHoleAuthor(db, actor, input, keys),
      ).resolves.toStrictEqual({ userId: 'private_user_1' });
    },
  );

  it.each(['no', ' '.repeat(5), 'x'.repeat(1001)])(
    'rejects invalid reason %j before database access',
    async (reason) => {
      const db = adapter();

      await expect(
        revealTreeHoleAuthor(db, actor, { ...input, reason }, keys),
      ).rejects.toBeInstanceOf(TreeHoleIdentityValidationError);
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );

  it('requires trimmed bounded report and post identifiers', async () => {
    const db = adapter();

    await expect(
      revealTreeHoleAuthor(db, actor, { ...input, reportId: ' ' }, keys),
    ).rejects.toBeInstanceOf(TreeHoleIdentityValidationError);
    await expect(
      revealTreeHoleAuthor(
        db,
        actor,
        { ...input, postId: 'x'.repeat(192) },
        keys,
      ),
    ).rejects.toBeInstanceOf(TreeHoleIdentityValidationError);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a stored/envelope key version mismatch before audit', async () => {
    const envelope = sealAnonymousIdentity('private_user_1', keys, 1);
    const db = adapter({
      post: {
        anonymousCiphertext: serializeAnonymousIdentityEnvelope(envelope),
        anonymousKeyVersion: 2,
        campusId: actor.campusId,
        id: input.postId,
        kind: 'TREE_HOLE',
      },
    });

    await expect(
      revealTreeHoleAuthor(db, actor, input, keys),
    ).rejects.toBeInstanceOf(AnonymousIdentityError);
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{'],
    ['malformed envelope', JSON.stringify({ keyVersion: 1 })],
  ])(
    'rejects %s without auditing or leaking stored data',
    async (_, stored) => {
      const db = adapter({
        post: {
          anonymousCiphertext: stored,
          anonymousKeyVersion: 1,
          campusId: actor.campusId,
          id: input.postId,
          kind: 'TREE_HOLE',
        },
      });

      await expect(
        revealTreeHoleAuthor(db, actor, input, keys),
      ).rejects.toBeInstanceOf(AnonymousIdentityError);
      expect(db.auditLog.create).not.toHaveBeenCalled();
    },
  );
});

const sessionAdmin = {
  campusId: actor.campusId,
  email: 'admin@example.edu',
  emailVerifiedAt: new Date(),
  id: actor.id,
  name: 'Administrator',
  role: 'ADMIN' as const,
  status: 'ACTIVE' as const,
};
const applicationOrigin = new URL(
  process.env.APP_URL ?? 'http://localhost:3000',
).origin;

function routeRequest(
  body: unknown,
  options: {
    contentLength?: number;
    contentType?: string;
    origin?: string;
    raw?: boolean;
  } = {},
) {
  const headers = new Headers({
    'content-type': options.contentType ?? 'application/json',
    origin: options.origin ?? applicationOrigin,
  });
  if (options.contentLength !== undefined) {
    headers.set('content-length', String(options.contentLength));
  }
  return new Request('http://localhost/api/admin/tree-hole-identity', {
    body: options.raw ? String(body) : JSON.stringify(body),
    headers,
    method: 'POST',
  });
}

describe('tree-hole identity admin route', () => {
  it('exports only a dynamic Node POST handler', () => {
    expect(treeHoleIdentityRoute.runtime).toBe('nodejs');
    expect(treeHoleIdentityRoute.dynamic).toBe('force-dynamic');
    expect(treeHoleIdentityRoute.POST).toBeTypeOf('function');
    expect(Object.hasOwn(treeHoleIdentityRoute, 'GET')).toBe(false);
  });

  it('rejects cross-origin requests before authentication', async () => {
    const resolveUser = vi.fn(async () => sessionAdmin);
    const reveal = vi.fn();

    const response = await treeHoleIdentityRoute.handleTreeHoleIdentityPost(
      routeRequest(input, { origin: 'https://attacker.example' }),
      { resolveUser, reveal },
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toContain('no-store');
    await expect(response.json()).resolves.toEqual({
      message: 'Invalid request origin.',
    });
    expect(resolveUser).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
  });

  it('requires an authenticated active administrator', async () => {
    const reveal = vi.fn();
    const unauthenticated =
      await treeHoleIdentityRoute.handleTreeHoleIdentityPost(
        routeRequest(input),
        { resolveUser: async () => null, reveal },
      );
    const moderator = await treeHoleIdentityRoute.handleTreeHoleIdentityPost(
      routeRequest(input),
      {
        resolveUser: async () => ({ ...sessionAdmin, role: 'MODERATOR' }),
        reveal,
      },
    );

    expect(unauthenticated.status).toBe(401);
    expect(moderator.status).toBe(403);
    expect(reveal).not.toHaveBeenCalled();
  });

  it('dispatches a strict trimmed body and returns only userId', async () => {
    const reveal = vi.fn(async () => ({
      anonymousFingerprint: 'must-not-cross-route-boundary',
      userId: 'private_user_1',
    }));

    const response = await treeHoleIdentityRoute.handleTreeHoleIdentityPost(
      routeRequest({
        postId: `  ${input.postId}  `,
        reason: `  ${input.reason}  `,
        reportId: `  ${input.reportId}  `,
      }),
      { resolveUser: async () => sessionAdmin, reveal },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    await expect(response.json()).resolves.toStrictEqual({
      userId: 'private_user_1',
    });
    expect(reveal).toHaveBeenCalledWith(actor, input);
  });

  it.each([
    ['unknown field', { ...input, userId: 'attacker_selected' }],
    ['short reason', { ...input, reason: 'no' }],
    ['missing report', { postId: input.postId, reason: input.reason }],
  ])('rejects a strict-body violation: %s', async (_, body) => {
    const reveal = vi.fn();
    const response = await treeHoleIdentityRoute.handleTreeHoleIdentityPost(
      routeRequest(body),
      { resolveUser: async () => sessionAdmin, reveal },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: 'Invalid tree-hole identity request.',
    });
    expect(reveal).not.toHaveBeenCalled();
  });

  it('enforces content type, valid JSON, and the bounded body limit', async () => {
    const reveal = vi.fn();
    const dependencies = { resolveUser: async () => sessionAdmin, reveal };
    const wrongType = await treeHoleIdentityRoute.handleTreeHoleIdentityPost(
      routeRequest(input, { contentType: 'text/plain' }),
      dependencies,
    );
    const malformed = await treeHoleIdentityRoute.handleTreeHoleIdentityPost(
      routeRequest('{', { raw: true }),
      dependencies,
    );
    const tooLarge = await treeHoleIdentityRoute.handleTreeHoleIdentityPost(
      routeRequest(input, { contentLength: 64 * 1024 + 1 }),
      dependencies,
    );

    expect(wrongType.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(tooLarge.status).toBe(413);
    expect(reveal).not.toHaveBeenCalled();
  });

  it('maps domain denial and validation errors without target disclosure', async () => {
    const forbidden = await treeHoleIdentityRoute.handleTreeHoleIdentityPost(
      routeRequest(input),
      {
        resolveUser: async () => sessionAdmin,
        reveal: async () => {
          throw new TreeHoleIdentityForbiddenError();
        },
      },
    );
    const invalid = await treeHoleIdentityRoute.handleTreeHoleIdentityPost(
      routeRequest(input),
      {
        resolveUser: async () => sessionAdmin,
        reveal: async () => {
          throw new TreeHoleIdentityValidationError();
        },
      },
    );

    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({
      message: 'Insufficient permissions.',
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      message: 'Invalid administration request.',
    });
  });

  it('maps crypto and unexpected failures to one non-sensitive response', async () => {
    const response = await treeHoleIdentityRoute.handleTreeHoleIdentityPost(
      routeRequest(input),
      {
        resolveUser: async () => sessionAdmin,
        reveal: async () => {
          throw new AnonymousIdentityError(
            'DECRYPTION_FAILED',
            'private_user_1 ciphertext iv tag',
          );
        },
      },
    );

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain('Unable to complete administration request.');
    expect(body).not.toContain('private_user_1');
    expect(body).not.toContain('ciphertext');
    expect(body).not.toContain('iv');
    expect(body).not.toContain('tag');
  });
});
