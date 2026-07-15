import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbClient } from '@/lib/db';
import { getDefaultCampusSlug } from '@/lib/config';
import {
  createForumComment,
  createForumPost,
  deleteForumComment,
  deleteForumPost,
  type ForumAdapter,
  ForumNotFoundError,
  ForumVerificationRequiredError,
  listForumPosts,
  toggleForumLike,
  updateForumPost,
} from '@/lib/domain/forum';
import {
  createReport,
  ReportDuplicateError,
  ReportNotFoundError,
  ReportOwnContentError,
  type ReportsAdapter,
} from '@/lib/domain/reports';
import {
  revealTreeHoleAuthor,
  TreeHoleIdentityForbiddenError,
  type TreeHoleIdentityAdapter,
} from '@/lib/domain/tree-hole-identity';
import { preparePublishingAssessmentBatch } from '@/lib/moderation/content-assessment';
import {
  fingerprintAnonymousUser,
  sealAnonymousIdentity,
  serializeAnonymousIdentityEnvelope,
  type AnonymousIdentityKeyring,
} from '@/lib/security/anonymous-identity';
import { assertSafeTestDatabase } from '@/tests/helpers/database-safety';

const describeWithDatabase = describe.skipIf(!process.env.DATABASE_URL);
const DATABASE_LOCK_WAIT_TIMEOUT_MS = 2_000;
const testKeys: AnonymousIdentityKeyring = {
  currentVersion: 1,
  encryptionKeys: new Map([[1, Buffer.alloc(32, 0x61)]]),
  fingerprintKey: Buffer.alloc(32, 0x62),
};

async function waitForForumDatabaseLock(
  db: ReturnType<typeof createDbClient>,
  applicationName: string,
) {
  const deadline = Date.now() + DATABASE_LOCK_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const activity = await db.$queryRawUnsafe<
      Array<{ waitEventType: string | null }>
    >(
      `SELECT wait_event_type AS "waitEventType"
       FROM pg_stat_activity
       WHERE application_name = $1`,
      applicationName,
    );
    if (activity.some(({ waitEventType }) => waitEventType === 'Lock')) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Database client ${applicationName} did not wait on a lock within ${DATABASE_LOCK_WAIT_TIMEOUT_MS}ms`,
  );
}

function namedDatabaseUrl(applicationName: string) {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  databaseUrl.searchParams.set('application_name', applicationName);
  databaseUrl.searchParams.set('options', '-c statement_timeout=3000');
  return databaseUrl.toString();
}

function auditBarrierAdapter(
  client: ReturnType<typeof createDbClient>,
  afterAudit: () => Promise<void>,
  beforeTransaction: () => void = () => undefined,
) {
  return {
    $transaction: <T>(
      operation: (tx: TreeHoleIdentityAdapter) => Promise<T>,
      options?: { isolationLevel: 'Serializable' },
    ) => {
      beforeTransaction();
      return client.$transaction(
        async (tx) =>
          operation({
            $queryRawUnsafe: <Result = unknown>(
              query: string,
              ...values: unknown[]
            ) => tx.$queryRawUnsafe<Result>(query, ...values),
            auditLog: {
              create: async (args: Record<string, unknown>) => {
                const audit = await tx.auditLog.create(args as never);
                await afterAudit();
                return audit;
              },
            },
            forumPost: {
              findFirst: (args: Record<string, unknown>) =>
                tx.forumPost.findFirst(args as never),
            },
            report: {
              findFirst: (args: Record<string, unknown>) =>
                tx.report.findFirst(args as never),
            },
          } as unknown as TreeHoleIdentityAdapter),
        options,
      );
    },
    auditLog: client.auditLog,
    forumPost: client.forumPost,
    report: client.report,
  } as unknown as TreeHoleIdentityAdapter;
}

function reportCreateBarrierAdapter(
  client: ReturnType<typeof createDbClient>,
  afterCreate: () => Promise<void>,
) {
  return {
    $transaction: <T>(
      operation: (tx: ReportsAdapter) => Promise<T>,
      options?: { isolationLevel: 'Serializable' },
    ) =>
      client.$transaction(
        (tx) =>
          operation({
            $queryRawUnsafe: <Result = unknown>(
              query: string,
              ...values: unknown[]
            ) => tx.$queryRawUnsafe<Result>(query, ...values),
            forumComment: {
              findFirst: (args: Record<string, unknown>) =>
                tx.forumComment.findFirst(args as never),
            },
            forumPost: {
              findFirst: (args: Record<string, unknown>) =>
                tx.forumPost.findFirst(args as never),
            },
            jobPost: tx.jobPost,
            marketplaceItem: tx.marketplaceItem,
            report: {
              create: async (args: Record<string, unknown>) => {
                const report = await tx.report.create(args as never);
                await afterCreate();
                return report;
              },
              findMany: (args: Record<string, unknown>) =>
                tx.report.findMany(args as never),
            },
            resource: tx.resource,
          } as unknown as ReportsAdapter),
        options,
      ),
  } as unknown as ReportsAdapter;
}

function deleteBarrierAdapter(
  client: ReturnType<typeof createDbClient>,
  subject: 'comment' | 'post',
  afterDelete: () => Promise<void>,
) {
  return {
    $transaction: <T>(
      operation: (tx: ForumAdapter) => Promise<T>,
      options?: { isolationLevel: 'Serializable' },
    ) =>
      client.$transaction(
        (tx) =>
          operation({
            $queryRawUnsafe: <Result = unknown>(
              query: string,
              ...values: unknown[]
            ) => tx.$queryRawUnsafe<Result>(query, ...values),
            forumComment: {
              count: (args: Record<string, unknown>) =>
                tx.forumComment.count(args as never),
              create: (args: Record<string, unknown>) =>
                tx.forumComment.create(args as never),
              delete: async (args: Record<string, unknown>) => {
                const deleted = await tx.forumComment.delete(args as never);
                if (subject === 'comment') await afterDelete();
                return deleted;
              },
              findFirst: (args: Record<string, unknown>) =>
                tx.forumComment.findFirst(args as never),
              findMany: (args: Record<string, unknown>) =>
                tx.forumComment.findMany(args as never),
              update: (args: Record<string, unknown>) =>
                tx.forumComment.update(args as never),
            },
            forumPost: {
              count: (args: Record<string, unknown>) =>
                tx.forumPost.count(args as never),
              create: (args: Record<string, unknown>) =>
                tx.forumPost.create(args as never),
              delete: async (args: Record<string, unknown>) => {
                const deleted = await tx.forumPost.delete(args as never);
                if (subject === 'post') await afterDelete();
                return deleted;
              },
              findFirst: (args: Record<string, unknown>) =>
                tx.forumPost.findFirst(args as never),
              findMany: (args: Record<string, unknown>) =>
                tx.forumPost.findMany(args as never),
              update: (args: Record<string, unknown>) =>
                tx.forumPost.update(args as never),
            },
            report: {
              findFirst: (args: Record<string, unknown>) =>
                tx.report.findFirst(args as never),
            },
          } as unknown as ForumAdapter),
        options,
      ),
  } as unknown as ForumAdapter;
}

describeWithDatabase('forum anonymous identity persistence', () => {
  let db: ReturnType<typeof createDbClient>;
  let campusId = '';
  let adminId = '';
  let moderatorId = '';
  let anonymousUserId = '';
  let categorySlug = '';
  let treeHoleId = '';
  let reportId = '';

  beforeAll(async () => {
    assertSafeTestDatabase(process.env);
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
    categorySlug = category.slug;
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

  async function createActiveReport() {
    return db.report.create({
      data: {
        campusId,
        details: 'Run-scoped report for a report-lock ordering test.',
        reason: 'OTHER',
        reporterId: moderatorId,
        status: 'OPEN',
        targetId: treeHoleId,
        targetType: 'FORUM_POST',
      },
    });
  }

  async function createDiscussionSubject(withComment: boolean) {
    const suffix = randomUUID().replaceAll('-', '');
    const post = await db.forumPost.create({
      data: {
        authorId: anonymousUserId,
        body: `Run-scoped lock subject body ${suffix}.`,
        campusId,
        category: categorySlug,
        kind: 'DISCUSSION',
        status: 'PUBLISHED',
        title: `Run-scoped lock subject ${suffix}`,
      },
    });
    const comment = withComment
      ? await db.forumComment.create({
          data: {
            authorId: anonymousUserId,
            body: `Run-scoped lock comment ${suffix}.`,
            postId: post.id,
            status: 'PUBLISHED',
          },
        })
      : null;
    return { comment, post };
  }

  afterAll(async () => {
    if (campusId) {
      await db.auditLog.deleteMany({ where: { campusId } });
      await db.contentAssessment.deleteMany({ where: { campusId } });
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

  it('atomically keeps an AI-reviewed forum post pending with its assessment', async () => {
    const adapter = db as unknown as ForumAdapter;
    const targetId = `assessed-forum-${randomUUID()}`;
    const publishing = {
      generateTargetId: () => targetId,
      prepare: (
        input: Parameters<typeof preparePublishingAssessmentBatch>[1],
      ) =>
        preparePublishingAssessmentBatch(adapter, input, {
          localGate: async () => null,
          provider: async () => ({
            adminSignals: ['integration-review'],
            categories: ['其他风险'] as const,
            decision: 'PASS' as const,
            reasonZh: '风险分达到人工复核阈值',
            riskScore: 55,
            suggestionZh: '请等待管理员人工确认',
          }),
        }),
    };

    const created = await createForumPost(
      adapter,
      {
        campusId,
        emailVerifiedAt: new Date(),
        id: anonymousUserId,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
      {
        body: 'This integration discussion is long enough for assessment.',
        category: categorySlug,
        kind: 'DISCUSSION',
        title: 'Assessed integration discussion',
      },
      testKeys,
      {},
      publishing,
    );

    expect(created).toMatchObject({ id: targetId, status: 'PENDING' });
    await expect(
      db.contentAssessment.findFirstOrThrow({
        where: { campusId, targetId, targetType: 'FORUM_POST' },
      }),
    ).resolves.toMatchObject({
      decision: 'REVIEW',
      providerStatus: 'COMPLETED',
      riskScore: 55,
    });
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

  it('rejects an oversized serialized tree-hole envelope at the database boundary', async () => {
    const directClient = new Client({
      connectionString: process.env.DATABASE_URL,
    });
    await directClient.connect();
    try {
      await directClient.query("SET statement_timeout = '3s'");
      await expect(
        directClient.query(
          `INSERT INTO "ForumPost"
             (id, "campusId", kind, "anonymousCiphertext",
              "anonymousFingerprint", "anonymousKeyVersion", "publicCode",
              title, body, category, "updatedAt")
           VALUES ($1, $2, 'TREE_HOLE', $3, $4, 1, $5, $6, $7, $8, now())`,
          [
            `oversized-envelope-${randomUUID()}`,
            campusId,
            'x'.repeat(2_049),
            'a'.repeat(64),
            randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase(),
            'Oversized envelope database boundary',
            'The database must reject an envelope over the shared cap.',
            categorySlug,
          ],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await directClient.end();
    }
  });

  it('rechecks a closed report after a concurrent close commits', async () => {
    const report = await createActiveReport();
    const suffix = randomUUID().replaceAll('-', '');
    const revealName = `rv-close-${suffix}`;
    const closer = new Client({
      application_name: `close-first-${suffix}`,
      connectionString: process.env.DATABASE_URL,
    });
    const revealDb = createDbClient(namedDatabaseUrl(revealName));
    let transactionAttempts = 0;
    const revealAdapter = auditBarrierAdapter(
      revealDb,
      async () => undefined,
      () => {
        transactionAttempts += 1;
      },
    );
    await closer.connect();
    try {
      await closer.query("SET statement_timeout = '3s'");
      await closer.query('BEGIN');
      await closer.query(
        `UPDATE "Report" SET status = 'DISMISSED' WHERE id = $1`,
        [report.id],
      );

      const revealOutcome = revealTreeHoleAuthor(
        revealAdapter,
        { campusId, id: adminId, role: 'ADMIN' },
        {
          postId: treeHoleId,
          reason: 'The close must win before identity authorization is read.',
          reportId: report.id,
        },
        testKeys,
      ).then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (error: unknown) => ({ error, status: 'rejected' as const }),
      );

      await waitForForumDatabaseLock(db, revealName);
      await closer.query('COMMIT');
      const outcome = await revealOutcome;
      expect(transactionAttempts).toBe(2);
      expect(outcome).toMatchObject({
        error: expect.any(TreeHoleIdentityForbiddenError),
        status: 'rejected',
      });
      await expect(
        db.auditLog.count({
          where: {
            action: 'TREE_HOLE_AUTHOR_REVEALED',
            subjectId: report.id,
          },
        }),
      ).resolves.toBe(0);
      await expect(
        db.report.findUniqueOrThrow({ where: { id: report.id } }),
      ).resolves.toMatchObject({ status: 'DISMISSED' });
    } finally {
      await Promise.allSettled([closer.query('ROLLBACK')]);
      await Promise.all([closer.end(), revealDb.$disconnect()]);
    }
  }, 10_000);

  it('holds the report row lock until a successful reveal commits', async () => {
    const report = await createActiveReport();
    const suffix = randomUUID().replaceAll('-', '');
    const revealDb = createDbClient(namedDatabaseUrl(`rv-first-${suffix}`));
    const closerName = `close-after-${suffix}`;
    const closer = new Client({
      application_name: closerName,
      connectionString: process.env.DATABASE_URL,
    });
    let signalAuditReached!: () => void;
    const auditReached = new Promise<void>((resolve) => {
      signalAuditReached = resolve;
    });
    let releaseReveal!: () => void;
    const revealMayCommit = new Promise<void>((resolve) => {
      releaseReveal = resolve;
    });
    const revealAdapter = auditBarrierAdapter(revealDb, async () => {
      signalAuditReached();
      await revealMayCommit;
    });

    await closer.connect();
    try {
      await closer.query("SET statement_timeout = '3s'");
      const reveal = revealTreeHoleAuthor(
        revealAdapter,
        { campusId, id: adminId, role: 'ADMIN' },
        {
          postId: treeHoleId,
          reason: 'The audited reveal must commit before report closure.',
          reportId: report.id,
        },
        testKeys,
      );
      await auditReached;

      await closer.query('BEGIN');
      const closeUpdate = closer.query(
        `UPDATE "Report" SET status = 'DISMISSED' WHERE id = $1`,
        [report.id],
      );
      await waitForForumDatabaseLock(db, closerName);
      releaseReveal();

      await expect(reveal).resolves.toStrictEqual({ userId: anonymousUserId });
      await expect(closeUpdate).resolves.toMatchObject({ rowCount: 1 });
      await closer.query('COMMIT');
      await expect(
        db.auditLog.count({
          where: {
            action: 'TREE_HOLE_AUTHOR_REVEALED',
            subjectId: report.id,
          },
        }),
      ).resolves.toBe(1);
      await expect(
        db.report.findUniqueOrThrow({ where: { id: report.id } }),
      ).resolves.toMatchObject({ status: 'DISMISSED' });
    } finally {
      releaseReveal?.();
      await Promise.allSettled([closer.query('ROLLBACK')]);
      await Promise.all([closer.end(), revealDb.$disconnect()]);
    }
  }, 10_000);

  it('supports public discussion discovery and verified-only tree-hole discovery', async () => {
    const forumDb = db as unknown as ForumAdapter;
    const owner = {
      campusId,
      emailVerifiedAt: new Date(),
      id: anonymousUserId,
      role: 'STUDENT' as const,
      status: 'ACTIVE' as const,
    };
    const discussion = await createForumPost(forumDb, owner, {
      body: 'Run-scoped public discussion body for forum integration.',
      category: categorySlug,
      kind: 'DISCUSSION',
      title: 'Run-scoped public discussion',
    });
    const publicAdapter = {
      campus: {
        findFirst: async () => ({
          id: campusId,
          isActive: true,
          slug: getDefaultCampusSlug(),
        }),
      },
      forumPost: db.forumPost,
    } as unknown as ForumAdapter;
    const publicList = await listForumPosts(publicAdapter, null, {
      page: 1,
      pageSize: 20,
      query: 'public discussion',
      view: 'discussion',
    });
    expect(publicList.items.some(({ id }) => id === discussion.id)).toBe(true);

    await expect(
      listForumPosts(
        forumDb,
        { ...owner, emailVerifiedAt: null },
        { page: 1, pageSize: 20, view: 'tree-hole' },
      ),
    ).rejects.toBeInstanceOf(ForumVerificationRequiredError);
    const treeHoles = await listForumPosts(forumDb, owner, {
      page: 1,
      pageSize: 20,
      view: 'tree-hole',
    });
    const ordinaryJson = JSON.stringify(treeHoles);
    expect(treeHoles.items.some(({ id }) => id === treeHoleId)).toBe(true);
    expect(ordinaryJson).not.toContain(anonymousUserId);
    expect(ordinaryJson).not.toContain('anonymousCiphertext');
    expect(ordinaryJson).not.toContain('anonymousFingerprint');
    expect(ordinaryJson).not.toContain('anonymousKeyVersion');
  });

  it('enforces owner edit/delete and preserves cross-user ownership', async () => {
    const forumDb = db as unknown as ForumAdapter;
    const owner = {
      campusId,
      emailVerifiedAt: new Date(),
      id: anonymousUserId,
      role: 'STUDENT' as const,
      status: 'ACTIVE' as const,
    };
    const other = { ...owner, id: moderatorId, role: 'MODERATOR' as const };
    const created = await createForumPost(forumDb, owner, {
      body: 'Run-scoped owner lifecycle discussion body.',
      category: categorySlug,
      kind: 'DISCUSSION',
      title: 'Run-scoped owner lifecycle',
    });
    await expect(
      updateForumPost(forumDb, other, {
        changes: { title: 'Cross-user edit must fail' },
        id: created.id,
        view: 'discussion',
      }),
    ).rejects.toBeInstanceOf(ForumNotFoundError);
    await expect(
      updateForumPost(forumDb, owner, {
        changes: { title: 'Owner-updated lifecycle title' },
        id: created.id,
        view: 'discussion',
      }),
    ).resolves.toMatchObject({ title: 'Owner-updated lifecycle title' });
    await expect(
      deleteForumPost(forumDb, owner, {
        id: created.id,
        view: 'discussion',
      }),
    ).resolves.toMatchObject({ archived: false, deleted: true });
    await expect(
      db.forumPost.findUnique({ where: { id: created.id } }),
    ).resolves.toBeNull();
  });

  it('keeps tree-hole creation private and rejects all tree-hole comments', async () => {
    const forumDb = db as unknown as ForumAdapter;
    const owner = {
      campusId,
      emailVerifiedAt: new Date(),
      id: anonymousUserId,
      role: 'STUDENT' as const,
      status: 'ACTIVE' as const,
    };
    const tree = await createForumPost(
      forumDb,
      owner,
      {
        body: 'Run-scoped anonymous tree-hole privacy body.',
        category: categorySlug,
        kind: 'TREE_HOLE',
        title: 'Run-scoped anonymous privacy',
      },
      testKeys,
    );
    const json = JSON.stringify(tree);
    expect(json).not.toContain(anonymousUserId);
    expect(json).not.toContain('anonymous');
    await expect(
      createForumComment(forumDb, owner, {
        body: 'Tree-hole comments must remain disabled.',
        postId: tree.id,
      }),
    ).rejects.toBeInstanceOf(ForumNotFoundError);
  });

  it('serializes concurrent like toggles to one unique final state', async () => {
    const forumDb = db as unknown as ForumAdapter;
    const owner = {
      campusId,
      emailVerifiedAt: new Date(),
      id: anonymousUserId,
      role: 'STUDENT' as const,
      status: 'ACTIVE' as const,
    };
    const discussion = await createForumPost(forumDb, owner, {
      body: 'Run-scoped concurrent like discussion body.',
      category: categorySlug,
      kind: 'DISCUSSION',
      title: 'Run-scoped concurrent likes',
    });
    const outcomes = await Promise.all([
      toggleForumLike(forumDb, owner, { postId: discussion.id }),
      toggleForumLike(forumDb, owner, { postId: discussion.id }),
    ]);
    expect(outcomes.map(({ liked }) => liked).sort()).toStrictEqual([
      false,
      true,
    ]);
    await expect(
      db.forumLike.count({
        where: { postId: discussion.id, userId: anonymousUserId },
      }),
    ).resolves.toBe(0);
  });

  it('enforces forum report self, duplicate, target, and hidden-content rules', async () => {
    const forumDb = db as unknown as ForumAdapter;
    const reportsDb = db as unknown as ReportsAdapter;
    const owner = {
      campusId,
      emailVerifiedAt: new Date(),
      id: anonymousUserId,
      role: 'STUDENT' as const,
      status: 'ACTIVE' as const,
    };
    const reporter = {
      campusId,
      emailVerifiedAt: new Date(),
      id: moderatorId,
      role: 'MODERATOR' as const,
      status: 'ACTIVE' as const,
    };
    const discussion = await createForumPost(forumDb, owner, {
      body: 'Run-scoped report target discussion body.',
      category: categorySlug,
      kind: 'DISCUSSION',
      title: 'Run-scoped report target',
    });
    const target = {
      reason: 'SPAM' as const,
      targetId: discussion.id,
      targetType: 'FORUM_POST' as const,
    };
    await expect(
      createReport(reportsDb, owner, target, testKeys),
    ).rejects.toBeInstanceOf(ReportOwnContentError);
    await createReport(reportsDb, reporter, target, testKeys);
    await expect(
      createReport(reportsDb, reporter, target, testKeys),
    ).rejects.toBeInstanceOf(ReportDuplicateError);

    await db.forumPost.update({
      data: { status: 'HIDDEN' },
      where: { id: discussion.id },
    });
    await expect(
      toggleForumLike(forumDb, reporter, { postId: discussion.id }),
    ).rejects.toBeInstanceOf(ForumNotFoundError);
    await expect(
      createForumComment(forumDb, reporter, {
        body: 'Hidden posts cannot receive comments.',
        postId: discussion.id,
      }),
    ).rejects.toBeInstanceOf(ForumNotFoundError);
    await expect(
      createReport(reportsDb, { ...reporter, id: adminId }, target, testKeys),
    ).rejects.toBeInstanceOf(ReportNotFoundError);
  });

  it('archives a post and retains a descendant comment with active report evidence', async () => {
    const { comment, post } = await createDiscussionSubject(true);
    if (!comment) throw new Error('Expected a run-scoped comment fixture.');
    const reporter = {
      campusId,
      emailVerifiedAt: new Date(),
      id: moderatorId,
      status: 'ACTIVE' as const,
    };
    const owner = {
      campusId,
      emailVerifiedAt: new Date(),
      id: anonymousUserId,
      role: 'STUDENT' as const,
      status: 'ACTIVE' as const,
    };
    const report = await createReport(
      db as unknown as ReportsAdapter,
      reporter,
      {
        reason: 'HARASSMENT',
        targetId: comment.id,
        targetType: 'FORUM_COMMENT',
      },
    );

    await expect(
      deleteForumPost(db as unknown as ForumAdapter, owner, {
        id: post.id,
        view: 'discussion',
      }),
    ).resolves.toStrictEqual({
      archived: true,
      deleted: false,
      id: post.id,
    });
    await expect(
      db.forumPost.findUniqueOrThrow({ where: { id: post.id } }),
    ).resolves.toMatchObject({ status: 'ARCHIVED' });
    await expect(
      db.forumComment.findUniqueOrThrow({ where: { id: comment.id } }),
    ).resolves.toMatchObject({ postId: post.id });
    await expect(
      db.report.findUniqueOrThrow({ where: { id: String(report.id) } }),
    ).resolves.toMatchObject({
      status: 'OPEN',
      targetId: comment.id,
      targetType: 'FORUM_COMMENT',
    });
  });

  it.each([
    { subject: 'post' as const, winner: 'report' as const },
    { subject: 'post' as const, winner: 'delete' as const },
    { subject: 'comment' as const, winner: 'report' as const },
    { subject: 'comment' as const, winner: 'delete' as const },
  ])(
    'keeps $subject report/delete race consistent when $winner wins',
    async ({ subject, winner }) => {
      const { comment, post } = await createDiscussionSubject(
        subject === 'comment',
      );
      if (subject === 'comment' && !comment) {
        throw new Error('Expected a run-scoped comment race fixture.');
      }
      const targetId = subject === 'post' ? post.id : String(comment?.id);
      const reporter = {
        campusId,
        emailVerifiedAt: new Date(),
        id: moderatorId,
        status: 'ACTIVE' as const,
      };
      const owner = {
        campusId,
        emailVerifiedAt: new Date(),
        id: anonymousUserId,
        role: 'STUDENT' as const,
        status: 'ACTIVE' as const,
      };
      const suffix = randomUUID().replaceAll('-', '');
      const reportName = `forum-report-${winner}-${subject}-${suffix}`;
      const deleteName = `forum-delete-${winner}-${subject}-${suffix}`;
      const reportDb = createDbClient(namedDatabaseUrl(reportName));
      const deleteDb = createDbClient(namedDatabaseUrl(deleteName));
      let signalPaused!: () => void;
      const paused = new Promise<void>((resolve) => {
        signalPaused = resolve;
      });
      let releasePaused!: () => void;
      const mayCommit = new Promise<void>((resolve) => {
        releasePaused = resolve;
      });
      const barrier = async () => {
        signalPaused();
        await mayCommit;
      };
      const reportInput = {
        reason: 'SPAM' as const,
        targetId,
        targetType:
          subject === 'post'
            ? ('FORUM_POST' as const)
            : ('FORUM_COMMENT' as const),
      };
      const remove = (adapter: ForumAdapter) =>
        subject === 'post'
          ? deleteForumPost(adapter, owner, {
              id: post.id,
              view: 'discussion',
            })
          : deleteForumComment(adapter, owner, {
              commentId: targetId,
              postId: post.id,
            });

      try {
        if (winner === 'report') {
          const reportOutcome = createReport(
            reportCreateBarrierAdapter(reportDb, barrier),
            reporter,
            reportInput,
          );
          await paused;
          const deleteOutcome = remove(deleteDb as unknown as ForumAdapter);
          await waitForForumDatabaseLock(db, deleteName);
          releasePaused();

          await expect(reportOutcome).resolves.toMatchObject({
            status: 'OPEN',
          });
          await expect(deleteOutcome).resolves.toMatchObject({
            archived: true,
            deleted: false,
          });
          if (subject === 'post') {
            await expect(
              db.forumPost.findUniqueOrThrow({ where: { id: post.id } }),
            ).resolves.toMatchObject({ status: 'ARCHIVED' });
          } else {
            await expect(
              db.forumComment.findUniqueOrThrow({ where: { id: targetId } }),
            ).resolves.toMatchObject({ status: 'ARCHIVED' });
          }
          await expect(
            db.report.count({
              where: {
                status: 'OPEN',
                targetId,
                targetType: reportInput.targetType,
              },
            }),
          ).resolves.toBe(1);
        } else {
          const deleteOutcome = remove(
            deleteBarrierAdapter(deleteDb, subject, barrier),
          );
          await paused;
          const reportOutcome = createReport(
            reportDb as unknown as ReportsAdapter,
            reporter,
            reportInput,
          );
          await waitForForumDatabaseLock(db, reportName);
          releasePaused();

          await expect(deleteOutcome).resolves.toMatchObject({
            archived: false,
            deleted: true,
          });
          await expect(reportOutcome).rejects.toBeInstanceOf(
            ReportNotFoundError,
          );
          await expect(
            db.report.count({
              where: {
                status: 'OPEN',
                targetId,
                targetType: reportInput.targetType,
              },
            }),
          ).resolves.toBe(0);
          if (subject === 'post') {
            await expect(
              db.forumPost.findUnique({ where: { id: post.id } }),
            ).resolves.toBeNull();
          } else {
            await expect(
              db.forumComment.findUnique({ where: { id: targetId } }),
            ).resolves.toBeNull();
          }
        }
      } finally {
        releasePaused?.();
        await Promise.all([reportDb.$disconnect(), deleteDb.$disconnect()]);
      }
    },
    15_000,
  );
});
