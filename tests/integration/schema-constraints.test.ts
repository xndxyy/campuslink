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
  let cleanupCampusIds: string[] = [];
  let cleanupStorageKeys: string[] = [];
  let reporterId: string | undefined;

  beforeAll(() => {
    db = createDbClient();
  });

  beforeEach(async () => {
    campusId = undefined;
    cleanupCampusIds = [];
    cleanupStorageKeys = [];
    reporterId = undefined;
    const suffix = randomUUID();
    const campus = await db.campus.create({
      data: {
        slug: `test-campus-${suffix}`,
        name: 'Schema Constraints Test Campus',
        allowedEmailDomain: `${suffix}.example.test`,
      },
    });

    campusId = campus.id;
    cleanupCampusIds.push(campus.id);

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
    if (reporterId) {
      await db.announcement.deleteMany({ where: { authorId: reporterId } });
    }
    if (cleanupCampusIds.length > 0) {
      await db.announcement.deleteMany({
        where: { campusId: { in: cleanupCampusIds } },
      });
    }
    if (reporterId) {
      await db.user.deleteMany({ where: { id: reporterId } });
    }
    if (cleanupStorageKeys.length > 0) {
      await db.storageDeletionJob.deleteMany({
        where: { storageKey: { in: cleanupStorageKeys } },
      });
    }
    if (cleanupCampusIds.length > 0) {
      await db.campus.deleteMany({
        where: { id: { in: cleanupCampusIds } },
      });
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

  it('sets a cover asset announcement id to null when its announcement is deleted', async () => {
    if (!reporterId || !campusId) {
      throw new Error('Test reporter setup failed');
    }

    const announcement = await db.announcement.create({
      data: {
        authorId: reporterId,
        body: 'Set-null announcement relation test',
        campusId,
        title: 'Set null cover',
      },
    });
    const asset = await db.asset.create({
      data: {
        announcementId: announcement.id,
        contentType: 'image/png',
        kind: 'ANNOUNCEMENT_IMAGE',
        ownerId: reporterId,
        sizeBytes: BigInt(1_024),
        status: 'READY',
        storageKey: `announcements/${reporterId}/${randomUUID()}.png`,
      },
    });

    await db.announcement.delete({ where: { id: announcement.id } });

    await expect(
      db.asset.findUniqueOrThrow({ where: { id: asset.id } }),
    ).resolves.toMatchObject({ announcementId: null });
  });

  it('restricts deleting an author while their announcement exists', async () => {
    if (!reporterId || !campusId) {
      throw new Error('Test reporter setup failed');
    }

    await db.announcement.create({
      data: {
        authorId: reporterId,
        body: 'Author restriction relation test',
        campusId,
        title: 'Restrict author',
      },
    });

    await expect(
      db.user.delete({ where: { id: reporterId } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('restricts deleting a campus referenced only by an announcement', async () => {
    if (!reporterId) {
      throw new Error('Test reporter setup failed');
    }

    const suffix = randomUUID();
    const announcementCampus = await db.campus.create({
      data: {
        slug: `announcement-campus-${suffix}`,
        name: 'Announcement-only Campus',
      },
    });
    cleanupCampusIds.push(announcementCampus.id);
    await db.announcement.create({
      data: {
        authorId: reporterId,
        body: 'Campus restriction relation test',
        campusId: announcementCampus.id,
        title: 'Restrict campus',
      },
    });

    await expect(
      db.campus.delete({ where: { id: announcementCampus.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('applies deletion job defaults and rejects duplicate storage keys', async () => {
    const storageKey = `announcements/deletion-test/${randomUUID()}.png`;
    cleanupStorageKeys.push(storageKey);

    const job = await db.storageDeletionJob.create({ data: { storageKey } });

    expect(job).toMatchObject({
      attempts: 0,
      lastError: null,
      storageKey,
    });
    expect(job.nextAttempt).toBeInstanceOf(Date);
    await expect(
      db.storageDeletionJob.create({ data: { storageKey } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
