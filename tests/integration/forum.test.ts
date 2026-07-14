import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbClient } from '@/lib/db';
import {
  revealTreeHoleAuthor,
  TreeHoleIdentityForbiddenError,
  type TreeHoleIdentityAdapter,
} from '@/lib/domain/tree-hole-identity';
import {
  fingerprintAnonymousUser,
  sealAnonymousIdentity,
  serializeAnonymousIdentityEnvelope,
  type AnonymousIdentityKeyring,
} from '@/lib/security/anonymous-identity';

const describeWithDatabase = describe.skipIf(!process.env.DATABASE_URL);
const testKeys: AnonymousIdentityKeyring = {
  currentVersion: 1,
  encryptionKeys: new Map([[1, Buffer.alloc(32, 0x61)]]),
  fingerprintKey: Buffer.alloc(32, 0x62),
};

describeWithDatabase('forum anonymous identity persistence', () => {
  let db: ReturnType<typeof createDbClient>;
  let campusId = '';
  let adminId = '';
  let moderatorId = '';
  let anonymousUserId = '';
  let treeHoleId = '';
  let reportId = '';

  beforeAll(async () => {
    db = createDbClient();
    const suffix = randomUUID();
    const campus = await db.campus.create({
      data: {
        allowedEmailDomain: `${suffix}.forum.test`,
        name: 'Forum Identity Test Campus',
        slug: `forum-identity-${suffix}`,
      },
    });
    campusId = campus.id;
    const [admin, moderator, anonymousUser] = await Promise.all([
      db.user.create({
        data: {
          campusId,
          email: `admin@${suffix}.forum.test`,
          emailVerifiedAt: new Date(),
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      }),
      db.user.create({
        data: {
          campusId,
          email: `moderator@${suffix}.forum.test`,
          emailVerifiedAt: new Date(),
          role: 'MODERATOR',
          status: 'ACTIVE',
        },
      }),
      db.user.create({
        data: {
          campusId,
          email: `anonymous@${suffix}.forum.test`,
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      }),
    ]);
    adminId = admin.id;
    moderatorId = moderator.id;
    anonymousUserId = anonymousUser.id;

    const category = await db.forumCategory.create({
      data: {
        campusId,
        label: 'Integration Tree Hole',
        slug: `tree-hole-${suffix}`.slice(0, 64),
      },
    });
    const envelope = sealAnonymousIdentity(anonymousUserId, testKeys);
    const treeHole = await db.forumPost.create({
      data: {
        anonymousCiphertext: serializeAnonymousIdentityEnvelope(envelope),
        anonymousFingerprint: fingerprintAnonymousUser(
          anonymousUserId,
          testKeys,
        ),
        anonymousKeyVersion: envelope.keyVersion,
        body: 'Run-scoped integration tree-hole body.',
        campusId,
        category: category.slug,
        kind: 'TREE_HOLE',
        publicCode: randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase(),
        status: 'PUBLISHED',
        title: 'Run-scoped integration tree hole',
      },
    });
    treeHoleId = treeHole.id;
    const report = await db.report.create({
      data: {
        campusId,
        details: 'A run-scoped report authorizing an identity review.',
        reason: 'OTHER',
        reporterId: moderatorId,
        status: 'OPEN',
        targetId: treeHoleId,
        targetType: 'FORUM_POST',
      },
    });
    reportId = report.id;
  });

  afterAll(async () => {
    if (campusId) {
      await db.auditLog.deleteMany({ where: { campusId } });
      await db.moderationAction.deleteMany({
        where: { actorId: { in: [adminId, moderatorId] } },
      });
      await db.report.deleteMany({ where: { campusId } });
      await db.forumLike.deleteMany({
        where: { post: { campusId } },
      });
      await db.forumComment.deleteMany({
        where: { post: { campusId } },
      });
      await db.forumPost.deleteMany({ where: { campusId } });
      await db.forumCategory.deleteMany({ where: { campusId } });
      await db.user.deleteMany({ where: { campusId } });
      await db.campus.delete({ where: { id: campusId } });
    }
    await db.$disconnect();
  });

  it('denies moderators and administrators without an active matching report', async () => {
    const adapter = db as unknown as TreeHoleIdentityAdapter;

    await expect(
      revealTreeHoleAuthor(
        adapter,
        { campusId, id: moderatorId, role: 'MODERATOR' },
        {
          postId: treeHoleId,
          reason: 'Moderators cannot reveal anonymous identities.',
          reportId,
        },
        testKeys,
      ),
    ).rejects.toBeInstanceOf(TreeHoleIdentityForbiddenError);
    await expect(
      revealTreeHoleAuthor(
        adapter,
        { campusId, id: adminId, role: 'ADMIN' },
        {
          postId: treeHoleId,
          reason: 'A missing report cannot authorize identity access.',
          reportId: `missing-${randomUUID()}`,
        },
        testKeys,
      ),
    ).rejects.toBeInstanceOf(TreeHoleIdentityForbiddenError);
    await expect(
      db.auditLog.count({
        where: { action: 'TREE_HOLE_AUTHOR_REVEALED', campusId },
      }),
    ).resolves.toBe(0);
  });

  it('reveals to an administrator and persists a non-sensitive report audit', async () => {
    const reason = 'Required for the documented campus safety investigation.';
    const result = await revealTreeHoleAuthor(
      db as unknown as TreeHoleIdentityAdapter,
      { campusId, id: adminId, role: 'ADMIN' },
      { postId: treeHoleId, reason, reportId },
      testKeys,
    );

    expect(result).toStrictEqual({ userId: anonymousUserId });
    const audit = await db.auditLog.findFirstOrThrow({
      select: {
        action: true,
        actorId: true,
        details: true,
        subjectId: true,
        subjectType: true,
      },
      where: {
        action: 'TREE_HOLE_AUTHOR_REVEALED',
        actorId: adminId,
        campusId,
        subjectId: reportId,
        subjectType: 'REPORT',
      },
    });
    expect(audit).toStrictEqual({
      action: 'TREE_HOLE_AUTHOR_REVEALED',
      actorId: adminId,
      details: { postId: treeHoleId, reason, reportId },
      subjectId: reportId,
      subjectType: 'REPORT',
    });
    const serializedAudit = JSON.stringify(audit);
    expect(serializedAudit).not.toContain(anonymousUserId);
    expect(serializedAudit).not.toContain('anonymousCiphertext');
    expect(serializedAudit).not.toContain('anonymousFingerprint');
    expect(serializedAudit).not.toContain('anonymousKeyVersion');
  });

  it('keeps identity fields out of an ordinary public-shaped query', async () => {
    const publicPost = await db.forumPost.findFirstOrThrow({
      select: {
        body: true,
        category: true,
        createdAt: true,
        id: true,
        kind: true,
        status: true,
        title: true,
      },
      where: { campusId, id: treeHoleId, status: 'PUBLISHED' },
    });

    expect(publicPost).not.toHaveProperty('authorId');
    expect(publicPost).not.toHaveProperty('anonymousCiphertext');
    expect(publicPost).not.toHaveProperty('anonymousFingerprint');
    expect(publicPost).not.toHaveProperty('anonymousKeyVersion');
    expect(JSON.stringify(publicPost)).not.toContain(anonymousUserId);
  });
});
