import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbClient } from '@/lib/db';
import {
  listOwnedContent,
  type ContentAdapter,
} from '@/lib/domain/content-service';
import {
  moderateContent,
  ModerationForbiddenError,
  resolveReport,
  type ModerationAdapter,
} from '@/lib/domain/moderation';

const describeWithDatabase = describe.skipIf(!process.env.DATABASE_URL);

describeWithDatabase('audited administration persistence', () => {
  let db: ReturnType<typeof createDbClient>;
  let campusId = '';
  let moderatorId = '';
  let ownerId = '';
  let reporterId = '';
  let pendingResourceId = '';
  let rejectedResourceId = '';
  let reportedResourceId = '';
  let reportId = '';

  beforeAll(async () => {
    db = createDbClient();
    const suffix = randomUUID();
    const campus = await db.campus.create({
      data: {
        allowedEmailDomain: `${suffix}.moderation.test`,
        name: 'Moderation Test Campus',
        slug: `moderation-${suffix}`,
      },
    });
    campusId = campus.id;
    const [moderator, owner, reporter] = await Promise.all([
      db.user.create({
        data: {
          campusId,
          email: `moderator@${suffix}.moderation.test`,
          emailVerifiedAt: new Date(),
          role: 'MODERATOR',
          status: 'ACTIVE',
        },
      }),
      db.user.create({
        data: {
          campusId,
          email: `owner@${suffix}.moderation.test`,
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      }),
      db.user.create({
        data: {
          campusId,
          email: `reporter@${suffix}.moderation.test`,
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      }),
    ]);
    moderatorId = moderator.id;
    ownerId = owner.id;
    reporterId = reporter.id;
    const [pending, rejected, reported] = await Promise.all([
      db.resource.create({
        data: {
          authorId: ownerId,
          campusId,
          status: 'PENDING',
          summary: 'Pending resource for a real moderation decision.',
          title: 'Pending moderation resource',
        },
      }),
      db.resource.create({
        data: {
          authorId: ownerId,
          campusId,
          status: 'PENDING',
          summary:
            'Pending resource whose author receives the decision reason.',
          title: 'Rejected moderation resource',
        },
      }),
      db.resource.create({
        data: {
          authorId: ownerId,
          campusId,
          status: 'PUBLISHED',
          summary: 'Published resource attached to a moderation report.',
          title: 'Reported moderation resource',
        },
      }),
    ]);
    pendingResourceId = pending.id;
    rejectedResourceId = rejected.id;
    reportedResourceId = reported.id;
    const report = await db.report.create({
      data: {
        details: 'Integration report requiring a hidden target.',
        reason: 'PROHIBITED',
        reporterId,
        status: 'TRIAGED',
        targetId: reportedResourceId,
        targetType: 'RESOURCE',
      },
    });
    reportId = report.id;
  });

  afterAll(async () => {
    if (campusId) {
      await db.auditLog.deleteMany({ where: { actorId: moderatorId } });
      await db.moderationAction.deleteMany({ where: { actorId: moderatorId } });
      await db.report.deleteMany({ where: { reporterId } });
      await db.resource.deleteMany({ where: { campusId } });
      await db.user.deleteMany({ where: { campusId } });
      await db.campus.delete({ where: { id: campusId } });
    }
    await db.$disconnect();
  });

  it('denies a student before changing content or writing audit records', async () => {
    const adapter = db as unknown as ModerationAdapter;
    await expect(
      moderateContent(
        adapter,
        { campusId, id: ownerId, role: 'STUDENT' },
        {
          action: 'APPROVE',
          reason: 'Student attempts to approve submitted content.',
          subjectId: pendingResourceId,
          subjectType: 'RESOURCE',
        },
      ),
    ).rejects.toBeInstanceOf(ModerationForbiddenError);
    await expect(
      db.resource.findUniqueOrThrow({ where: { id: pendingResourceId } }),
    ).resolves.toMatchObject({ status: 'PENDING' });
    await expect(
      db.moderationAction.count({ where: { actorId: ownerId } }),
    ).resolves.toBe(0);
  });

  it('publishes pending content and persists one immutable decision and audit', async () => {
    const reason = 'Course scope and attached material meet campus policy.';
    await moderateContent(
      db as unknown as ModerationAdapter,
      { campusId, id: moderatorId, role: 'MODERATOR' },
      {
        action: 'APPROVE',
        reason,
        subjectId: pendingResourceId,
        subjectType: 'RESOURCE',
      },
    );
    await expect(
      db.resource.findUniqueOrThrow({ where: { id: pendingResourceId } }),
    ).resolves.toMatchObject({ status: 'PUBLISHED' });
    await expect(
      db.moderationAction.count({
        where: {
          action: 'APPROVE',
          actorId: moderatorId,
          reason,
          subjectId: pendingResourceId,
          subjectType: 'RESOURCE',
        },
      }),
    ).resolves.toBe(1);
    await expect(
      db.auditLog.count({
        where: {
          action: 'CONTENT_APPROVED',
          actorId: moderatorId,
          subjectId: pendingResourceId,
          subjectType: 'RESOURCE',
        },
      }),
    ).resolves.toBe(1);
  });

  it('returns the latest rejection reason to the content author', async () => {
    const reason =
      'The submission omits required attribution and source details.';
    await moderateContent(
      db as unknown as ModerationAdapter,
      { campusId, id: moderatorId, role: 'MODERATOR' },
      {
        action: 'REJECT',
        reason,
        subjectId: rejectedResourceId,
        subjectType: 'RESOURCE',
      },
    );
    const submissions = await listOwnedContent(
      db as unknown as ContentAdapter,
      { campusId, id: ownerId, role: 'STUDENT' },
      'resource',
    );
    expect(
      submissions.find((item) => item.id === rejectedResourceId),
    ).toMatchObject({ decisionReason: reason, status: 'REJECTED' });
  });

  it('resolves a report, hides its target, and audits both state changes', async () => {
    const reason =
      'The report confirms prohibited material in the published resource.';
    await resolveReport(
      db as unknown as ModerationAdapter,
      { campusId, id: moderatorId, role: 'MODERATOR' },
      { hideTarget: true, reason, reportId },
    );
    await expect(
      db.report.findUniqueOrThrow({ where: { id: reportId } }),
    ).resolves.toMatchObject({ assigneeId: moderatorId, status: 'RESOLVED' });
    await expect(
      db.resource.findUniqueOrThrow({ where: { id: reportedResourceId } }),
    ).resolves.toMatchObject({ status: 'HIDDEN' });
    await expect(
      db.moderationAction.count({
        where: {
          actorId: moderatorId,
          subjectId: { in: [reportId, reportedResourceId] },
        },
      }),
    ).resolves.toBe(2);
    await expect(
      db.auditLog.count({
        where: {
          actorId: moderatorId,
          subjectId: { in: [reportId, reportedResourceId] },
        },
      }),
    ).resolves.toBe(2);
  });
});
