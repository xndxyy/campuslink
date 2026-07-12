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
    if (!reporterId) {
      throw new Error('Test reporter setup failed');
    }

    const targetId = `resource-${randomUUID()}`;
    const openReportKey = `${reporterId}:RESOURCE:${targetId}`;

    await db.report.create({
      data: {
        reporterId,
        targetType: 'RESOURCE',
        targetId,
        reason: 'Duplicate open-report constraint test',
        openReportKey,
      },
    });

    await expect(
      db.report.create({
        data: {
          reporterId,
          targetType: 'RESOURCE',
          targetId,
          reason: 'Duplicate open-report constraint test',
          openReportKey,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
