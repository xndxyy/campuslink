import { randomUUID } from 'node:crypto';

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { createDbClient } from '@/lib/db';

const describeWithDatabase = describe.skipIf(!process.env.DATABASE_URL);

describeWithDatabase('database schema constraints', () => {
  let db!: ReturnType<typeof createDbClient>;
  let campusId: string | undefined;
  let reporterId: string | undefined;

  beforeAll(() => {
    db = createDbClient();
  });

  beforeEach(async () => {
    const suffix = randomUUID();
    const campus = await db.campus.create({
      data: {
        slug: `test-campus-${suffix}`,
        name: 'Schema Constraints Test Campus',
        allowedEmailDomain: `${suffix}.example.test`,
      },
    });

    campusId = campus.id;

    const reporter = await db.user.create({
      data: {
        campusId,
        email: `schema-${suffix}@${suffix}.example.test`,
        passwordHash:
          '$2b$12$3PhfWpsS2TCwMa.ASaQKOeM.A7RZOc4xS5b07a0PWAZDvQkQ9t6Mi',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });

    reporterId = reporter.id;
  });

  afterEach(async () => {
    if (reporterId) {
      await db.asset.deleteMany({ where: { ownerId: reporterId } });
    }
    if (campusId) {
      await db.announcement.deleteMany({ where: { campusId } });
    }
    if (reporterId) {
      await db.user.delete({ where: { id: reporterId } });
    }
    if (campusId) {
      await db.campus.delete({ where: { id: campusId } });
    }
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('rejects duplicate favourites for the same user and target', async () => {
    if (!reporterId) {
      throw new Error('Test reporter setup failed');
    }

    const targetId = `resource-${randomUUID()}`;

    await db.favourite.create({
      data: { userId: reporterId, targetType: 'RESOURCE', targetId },
    });

    await expect(
      db.favourite.create({
        data: { userId: reporterId, targetType: 'RESOURCE', targetId },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects duplicate open reports for the same reporter and target', async () => {
    if (!reporterId || !campusId) {
      throw new Error('Test reporter setup failed');
    }

    const targetId = `resource-${randomUUID()}`;

    const initialReport = await db.report.create({
      data: {
        campusId,
        reporterId,
        targetType: 'RESOURCE',
        targetId,
        details: 'Duplicate open-report constraint test',
        reason: 'OTHER',
      },
    });

    await expect(
      db.report.create({
        data: {
          campusId,
          reporterId,
          targetType: 'RESOURCE',
          targetId,
          details: 'Duplicate open-report constraint test',
          reason: 'OTHER',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await db.report.update({
      where: { id: initialReport.id },
      data: { status: 'DISMISSED' },
    });

    const reopenedReport = await db.report.create({
      data: {
        campusId,
        reporterId,
        targetType: 'RESOURCE',
        targetId,
        details: 'A dismissed report may be reported again',
        reason: 'OTHER',
      },
    });

    expect(reopenedReport.status).toBe('OPEN');
  });

  it('allows one cover per announcement and rejects a duplicate cover', async () => {
    if (!reporterId || !campusId) {
      throw new Error('Test reporter setup failed');
    }

    const [firstAnnouncement, secondAnnouncement] = await Promise.all([
      db.announcement.create({
        data: {
          authorId: reporterId,
          body: 'First schema constraint announcement',
          campusId,
          title: 'First announcement',
        },
      }),
      db.announcement.create({
        data: {
          authorId: reporterId,
          body: 'Second schema constraint announcement',
          campusId,
          title: 'Second announcement',
        },
      }),
    ]);

    await Promise.all([
      db.asset.create({
        data: {
          announcementId: firstAnnouncement.id,
          contentType: 'image/png',
          kind: 'ANNOUNCEMENT_IMAGE',
          ownerId: reporterId,
          sizeBytes: BigInt(1_024),
          status: 'READY',
          storageKey: `announcements/${reporterId}/${randomUUID()}.png`,
        },
      }),
      db.asset.create({
        data: {
          announcementId: secondAnnouncement.id,
          contentType: 'image/webp',
          kind: 'ANNOUNCEMENT_IMAGE',
          ownerId: reporterId,
          sizeBytes: BigInt(2_048),
          status: 'READY',
          storageKey: `announcements/${reporterId}/${randomUUID()}.webp`,
        },
      }),
    ]);

    await expect(
      db.asset.create({
        data: {
          announcementId: firstAnnouncement.id,
          contentType: 'image/avif',
          kind: 'ANNOUNCEMENT_IMAGE',
          ownerId: reporterId,
          sizeBytes: BigInt(512),
          status: 'READY',
          storageKey: `announcements/${reporterId}/${randomUUID()}.avif`,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
