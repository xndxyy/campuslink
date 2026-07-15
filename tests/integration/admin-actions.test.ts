import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbClient } from '@/lib/db';
import {
  AdminConflictError,
  getManagedUserDetail,
  listManagedUsers,
  parseManagedUsersQuery,
  revokeManagedUserSessions,
  updateCampusConfig,
  updateManagedUser,
  type AdministrationAdapter,
} from '@/lib/domain/administration';
import { listAuditLogs, type AuditAdapter } from '@/lib/domain/audit';
import {
  listOwnedContent,
  type ContentAdapter,
} from '@/lib/domain/content-service';
import {
  listModerationReports,
  moderateContent,
  ModerationForbiddenError,
  ModerationConflictError,
  resolveReport,
  triageReport,
  type ModerationAdapter,
} from '@/lib/domain/moderation';
import { listReporterReports, type ReportsAdapter } from '@/lib/domain/reports';

const describeWithDatabase = describe.skipIf(!process.env.DATABASE_URL);

describeWithDatabase('audited administration persistence', () => {
  let db: ReturnType<typeof createDbClient>;
  let campusId = '';
  let moderatorId = '';
  let adminId = '';
  let managedUserId = '';
  let ownerId = '';
  let reporterId = '';
  let otherCampusId = '';
  let otherModeratorId = '';
  let otherReporterId = '';
  let pendingResourceId = '';
  let rejectedResourceId = '';
  let reportedResourceId = '';
  let reportId = '';

  beforeAll(async () => {
    db = createDbClient();
    const suffix = randomUUID();
    const campus = await db.campus.create({
      data: {
        name: 'Moderation Test Campus',
        slug: `moderation-${suffix}`,
      },
    });
    campusId = campus.id;
    const [moderator, admin, managedUser, owner, reporter] = await Promise.all([
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
          email: `admin@${suffix}.moderation.test`,
          emailVerifiedAt: new Date(),
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      }),
      db.user.create({
        data: {
          campusId,
          email: `managed@${suffix}.moderation.test`,
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
    adminId = admin.id;
    managedUserId = managedUser.id;
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
        campusId,
        details: 'Integration report requiring a hidden target.',
        reason: 'PROHIBITED',
        reporterId,
        status: 'OPEN',
        targetId: reportedResourceId,
        targetType: 'RESOURCE',
      },
    });
    reportId = report.id;

    await db.session.create({
      data: {
        expires: new Date(Date.now() + 60_000),
        sessionTokenHash: `managed-${suffix}`,
        userId: managedUserId,
      },
    });

    const otherCampus = await db.campus.create({
      data: {
        name: 'Other Moderation Campus',
        slug: `other-moderation-${suffix}`,
      },
    });
    otherCampusId = otherCampus.id;
    const [otherModerator, otherReporter] = await Promise.all([
      db.user.create({
        data: {
          campusId: otherCampusId,
          email: `moderator@${suffix}.other-moderation.test`,
          emailVerifiedAt: new Date(),
          role: 'MODERATOR',
          status: 'ACTIVE',
        },
      }),
      db.user.create({
        data: {
          campusId: otherCampusId,
          email: `reporter@${suffix}.other-moderation.test`,
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      }),
    ]);
    otherModeratorId = otherModerator.id;
    otherReporterId = otherReporter.id;
    const otherResource = await db.resource.create({
      data: {
        authorId: otherReporterId,
        campusId: otherCampusId,
        status: 'PUBLISHED',
        summary: 'Cross-campus report must never enter the primary queue.',
        title: 'Other campus resource',
      },
    });
    await db.report.create({
      data: {
        campusId: otherCampusId,
        details: 'Other campus internal report note.',
        reason: 'SPAM',
        reporterId: otherReporterId,
        targetId: otherResource.id,
        targetType: 'RESOURCE',
      },
    });
    await db.auditLog.create({
      data: {
        action: 'OTHER_CAMPUS_EVENT',
        actorId: otherModeratorId,
        campusId: otherCampusId,
        details: { reason: 'must remain isolated' },
        subjectId: otherResource.id,
        subjectType: 'RESOURCE',
      },
    });
  });

  afterAll(async () => {
    for (const id of [campusId, otherCampusId]) {
      if (!id) continue;
      await db.auditLog.deleteMany({ where: { campusId: id } });
      await db.moderationAction.deleteMany({
        where: {
          actorId: {
            in: [moderatorId, adminId, managedUserId, otherModeratorId],
          },
        },
      });
      await db.report.deleteMany({ where: { campusId: id } });
      await db.resource.deleteMany({ where: { campusId: id } });
      await db.session.deleteMany({
        where: {
          user: { campusId: id },
        },
      });
      await db.user.deleteMany({ where: { campusId: id } });
      await db.campus.delete({ where: { id } });
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

  it('returns only the latest moderation decision to the content author', async () => {
    const rejectionReason =
      'The submission omits required attribution and source details.';
    await moderateContent(
      db as unknown as ModerationAdapter,
      { campusId, id: moderatorId, role: 'MODERATOR' },
      {
        action: 'REJECT',
        reason: rejectionReason,
        subjectId: rejectedResourceId,
        subjectType: 'RESOURCE',
      },
    );
    await db.resource.update({
      data: { status: 'PENDING' },
      where: { id: rejectedResourceId },
    });
    const approvalReason =
      'The revised submission now includes complete attribution details.';
    await moderateContent(
      db as unknown as ModerationAdapter,
      { campusId, id: moderatorId, role: 'MODERATOR' },
      {
        action: 'APPROVE',
        reason: approvalReason,
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
    ).toMatchObject({
      decisionAction: 'APPROVE',
      decisionReason: approvalReason,
      status: 'PUBLISHED',
    });
  });

  it('enforces exact report lifecycle, resolves it, hides and restores its target', async () => {
    const reason =
      'The report confirms prohibited material in the published resource.';
    await expect(
      resolveReport(
        db as unknown as ModerationAdapter,
        { campusId, id: moderatorId, role: 'MODERATOR' },
        { hideTarget: true, reason, reportId },
      ),
    ).rejects.toBeInstanceOf(ModerationConflictError);
    await triageReport(
      db as unknown as ModerationAdapter,
      { campusId, id: moderatorId, role: 'MODERATOR' },
      { reason: 'Initial triage assigns the report for review.', reportId },
    );
    await expect(
      triageReport(
        db as unknown as ModerationAdapter,
        { campusId, id: moderatorId, role: 'MODERATOR' },
        { reason: 'Repeated triage must lose the status race.', reportId },
      ),
    ).rejects.toBeInstanceOf(ModerationConflictError);
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
    await moderateContent(
      db as unknown as ModerationAdapter,
      { campusId, id: moderatorId, role: 'MODERATOR' },
      {
        action: 'RESTORE',
        reason: 'A follow-up review confirms the corrected resource is safe.',
        subjectId: reportedResourceId,
        subjectType: 'RESOURCE',
      },
    );
    await expect(
      db.resource.findUniqueOrThrow({ where: { id: reportedResourceId } }),
    ).resolves.toMatchObject({ status: 'PUBLISHED' });
    await expect(
      db.moderationAction.count({
        where: {
          actorId: moderatorId,
          subjectId: { in: [reportId, reportedResourceId] },
        },
      }),
    ).resolves.toBe(4);
    await expect(
      db.auditLog.count({
        where: {
          actorId: moderatorId,
          subjectId: { in: [reportId, reportedResourceId] },
        },
      }),
    ).resolves.toBe(4);
  });

  it('keeps report and audit browsing within the administrator campus', async () => {
    const campusReport = await db.report.create({
      data: {
        campusId,
        details: 'Primary campus report visible to its own staff only.',
        reason: 'OTHER',
        reporterId,
        targetId: reportedResourceId,
        targetType: 'RESOURCE',
      },
    });
    const reports = await listModerationReports(
      db as unknown as ModerationAdapter,
      { campusId, id: moderatorId, role: 'MODERATOR' },
    );
    expect(reports.some((report) => report.id === campusReport.id)).toBe(true);
    expect(
      reports.some(
        (report) => report.details === 'Other campus internal report note.',
      ),
    ).toBe(false);

    const audit = await listAuditLogs(
      db as unknown as AuditAdapter,
      { campusId, id: adminId, role: 'ADMIN' },
      { pageSize: 100 },
    );
    expect(
      audit.items.some((entry) => entry.action === 'OTHER_CAMPUS_EVENT'),
    ).toBe(false);
    expect(audit.items.every((entry) => entry.campusId === undefined)).toBe(
      true,
    );
  });

  it('lists, inspects, and force-signs-out a managed user within one campus', async () => {
    await db.report.create({
      data: {
        campusId,
        details: 'Managed user submitted this run-scoped report.',
        reason: 'OTHER',
        reporterId: managedUserId,
        targetId: reportedResourceId,
        targetType: 'RESOURCE',
      },
    });
    await db.auditLog.create({
      data: {
        action: 'INTEGRATION_USER_REVIEW',
        actorId: adminId,
        campusId,
        details: {
          email: 'must-not-leak@example.edu',
          nested: { reason: 'Safe integration reason', token: 'must-not-leak' },
        },
        subjectId: managedUserId,
        subjectType: 'USER',
      },
    });
    const managed = await db.user.findUniqueOrThrow({
      where: { id: managedUserId },
    });
    const list = await listManagedUsers(
      db as unknown as AdministrationAdapter,
      { campusId, id: adminId, role: 'ADMIN' },
      parseManagedUsersQuery(
        new URLSearchParams({
          pageSize: '1',
          role: 'MODERATOR',
          search: managed.email,
          status: 'ACTIVE',
          verified: 'true',
        }),
      ).query,
    );
    expect(list.items.map((item) => item.id)).toEqual([managedUserId]);
    await expect(db.user.count({ where: { campusId } })).resolves.toBe(
      list.counts.total,
    );

    const detail = await getManagedUserDetail(
      db as unknown as AdministrationAdapter,
      { campusId, id: adminId, role: 'ADMIN' },
      managedUserId,
    );
    expect(detail.overview).toMatchObject({
      activeSessionCount: 1,
      email: managed.email,
      id: managedUserId,
    });
    expect(detail.reports.submittedCount).toBe(1);
    expect(detail.audit.recent).toContainEqual(
      expect.objectContaining({
        action: 'INTEGRATION_USER_REVIEW',
        details: { nested: { reason: 'Safe integration reason' } },
      }),
    );
    await expect(
      getManagedUserDetail(
        db as unknown as AdministrationAdapter,
        { campusId, id: adminId, role: 'ADMIN' },
        otherModeratorId,
      ),
    ).rejects.toBeInstanceOf(AdminConflictError);

    await expect(
      revokeManagedUserSessions(
        db as unknown as AdministrationAdapter,
        { campusId, id: adminId, role: 'ADMIN' },
        {
          reason: 'Integration security review signs out every device.',
          userId: managedUserId,
        },
      ),
    ).resolves.toEqual({ revokedCount: 1 });
    await expect(
      db.session.count({ where: { userId: managedUserId } }),
    ).resolves.toBe(0);
    const revocationAudit = await db.auditLog.findFirstOrThrow({
      where: {
        action: 'USER_SESSIONS_REVOKED',
        campusId,
        subjectId: managedUserId,
      },
    });
    expect(revocationAudit.details).toEqual({
      reason: 'Integration security review signs out every device.',
      revokedCount: 1,
    });
  });

  it('changes role and status, revokes sessions, and audits campus ownership', async () => {
    await updateManagedUser(
      db as unknown as AdministrationAdapter,
      { campusId, id: adminId, role: 'ADMIN' },
      {
        reason: 'Moderator assignment ended after the review period.',
        role: 'STUDENT',
        userId: managedUserId,
      },
    );
    await expect(
      db.session.count({ where: { userId: managedUserId } }),
    ).resolves.toBe(0);
    await expect(
      db.auditLog.count({
        where: {
          action: 'USER_ROLE_CHANGED',
          campusId,
          subjectId: managedUserId,
        },
      }),
    ).resolves.toBe(1);

    await db.user.update({
      data: { role: 'MODERATOR', status: 'ACTIVE' },
      where: { id: managedUserId },
    });
    await db.session.create({
      data: {
        expires: new Date(Date.now() + 60_000),
        sessionTokenHash: `managed-status-${randomUUID()}`,
        userId: managedUserId,
      },
    });
    await updateManagedUser(
      db as unknown as AdministrationAdapter,
      { campusId, id: adminId, role: 'ADMIN' },
      {
        reason: 'Account suspended after a completed safety review.',
        status: 'SUSPENDED',
        userId: managedUserId,
      },
    );
    await expect(
      db.session.count({ where: { userId: managedUserId } }),
    ).resolves.toBe(0);
  });

  it('updates campus configuration and keeps reporter outcomes neutral', async () => {
    await updateCampusConfig(
      db as unknown as AdministrationAdapter,
      { campusId, id: adminId, role: 'ADMIN' },
      {
        name: 'Updated Moderation Test Campus',
        reason: 'Integration test verifies audited campus configuration.',
      },
    );
    await expect(
      db.campus.findUniqueOrThrow({ where: { id: campusId } }),
    ).resolves.toMatchObject({
      name: 'Updated Moderation Test Campus',
    });
    const reporterView = await listReporterReports(
      db as unknown as ReportsAdapter,
      { campusId, id: reporterId },
      { pageSize: 50 },
    );
    for (const item of reporterView.items) {
      expect(item).not.toHaveProperty('details');
      expect(item).not.toHaveProperty('reason');
      expect(item).not.toHaveProperty('assigneeId');
    }
  });

  it('serializes concurrent final-admin removal so one active administrator remains', async () => {
    const suffix = randomUUID();
    const raceCampus = await db.campus.create({
      data: {
        name: 'Final Admin Race Campus',
        slug: `admin-race-${suffix}`,
      },
    });
    const [first, second] = await Promise.all([
      db.user.create({
        data: {
          campusId: raceCampus.id,
          email: `first@${suffix}.admin-race.test`,
          emailVerifiedAt: new Date(),
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      }),
      db.user.create({
        data: {
          campusId: raceCampus.id,
          email: `second@${suffix}.admin-race.test`,
          emailVerifiedAt: new Date(),
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      }),
    ]);
    try {
      const results = await Promise.allSettled([
        updateManagedUser(
          db as unknown as AdministrationAdapter,
          { campusId: raceCampus.id, id: first.id, role: 'ADMIN' },
          {
            reason: 'Concurrent demotion in final administrator race.',
            role: 'STUDENT',
            userId: second.id,
          },
        ),
        updateManagedUser(
          db as unknown as AdministrationAdapter,
          { campusId: raceCampus.id, id: second.id, role: 'ADMIN' },
          {
            reason: 'Concurrent suspension in final administrator race.',
            status: 'SUSPENDED',
            userId: first.id,
          },
        ),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      await expect(
        db.user.count({
          where: {
            campusId: raceCampus.id,
            role: 'ADMIN',
            status: 'ACTIVE',
          },
        }),
      ).resolves.toBe(1);
    } finally {
      await db.auditLog.deleteMany({ where: { campusId: raceCampus.id } });
      await db.user.deleteMany({ where: { campusId: raceCampus.id } });
      await db.campus.delete({ where: { id: raceCampus.id } });
    }
  });
});
