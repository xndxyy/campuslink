import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbClient } from '@/lib/db';
import {
  type ContentAdapter,
  ContentNotFoundError,
  deleteOwnedContent,
} from '@/lib/domain/content-service';

const describeWithDatabase = describe.skipIf(!process.env.DATABASE_URL);

describeWithDatabase('owned content deletion', () => {
  let db: ReturnType<typeof createDbClient>;
  let campusId = '';
  let ownerId = '';
  let otherId = '';
  const storageKeys: string[] = [];

  const actor = () => ({
    campusId,
    id: ownerId,
    role: 'STUDENT' as const,
  });

  async function createResourceFixture(status: 'DRAFT' | 'PENDING' | 'PUBLISHED' | 'REJECTED' | 'HIDDEN' | 'ARCHIVED') {
    const id = `delete-resource-${randomUUID()}`;
    const storageKey = `deletion-test/${randomUUID()}.pdf`;
    storageKeys.push(storageKey);
    await db.resource.create({
      data: {
        authorId: ownerId,
        campusId,
        id,
        status,
        summary: 'Deletion test resource.',
        title: 'Deletion test resource',
      },
    });
    await db.asset.create({
      data: {
        contentType: 'application/pdf',
        kind: 'RESOURCE_DOCUMENT',
        ownerId,
        resourceId: id,
        scanStatus: 'CLEAN',
        sizeBytes: 10,
        status: 'READY',
        storageKey,
      },
    });
    return { id, storageKey };
  }

  beforeAll(async () => {
    db = createDbClient();
    const suffix = randomUUID();
    const campus = await db.campus.create({
      data: { name: 'Deletion Test Campus', slug: `delete-${suffix}` },
    });
    campusId = campus.id;
    const [owner, other] = await Promise.all([
      db.user.create({
        data: {
          campusId,
          email: `owner-${suffix}@test.invalid`,
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      }),
      db.user.create({
        data: {
          campusId,
          email: `other-${suffix}@test.invalid`,
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      }),
    ]);
    ownerId = owner.id;
    otherId = other.id;
  });

  afterAll(async () => {
    try {
      if (campusId) {
        await db.report.deleteMany({ where: { campusId } });
        await db.favourite.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
        await db.asset.deleteMany({ where: { ownerId: { in: [ownerId, otherId] } } });
        await db.resource.deleteMany({ where: { campusId } });
        await db.storageDeletionJob.deleteMany({ where: { storageKey: { in: storageKeys } } });
        await db.user.deleteMany({ where: { campusId } });
        await db.campus.delete({ where: { id: campusId } });
      }
    } finally {
      await db.$disconnect();
    }
  });

  it.each(['DRAFT', 'PENDING', 'PUBLISHED', 'REJECTED', 'HIDDEN', 'ARCHIVED'] as const)(
    'deletes an owned resource in %s state when there is no active report',
    async (status) => {
      const fixture = await createResourceFixture(status);
      const result = await deleteOwnedContent(
        db as unknown as ContentAdapter,
        actor(),
        'resource',
        fixture.id,
      );

      expect(result).toEqual({ archived: false, deleted: true, id: fixture.id });
      await expect(db.resource.findUnique({ where: { id: fixture.id } })).resolves.toBeNull();
      await expect(
        db.storageDeletionJob.count({ where: { storageKey: fixture.storageKey } }),
      ).resolves.toBe(1);
    },
  );

  it('archives and marks an owner deletion when an active report exists', async () => {
    const fixture = await createResourceFixture('PUBLISHED');
    await db.report.create({
      data: {
        campusId,
        reason: 'SPAM',
        reporterId: otherId,
        status: 'OPEN',
        targetId: fixture.id,
        targetType: 'RESOURCE',
      },
    });

    const result = await deleteOwnedContent(
      db as unknown as ContentAdapter,
      actor(),
      'resource',
      fixture.id,
    );

    expect(result).toEqual({ archived: true, deleted: false, id: fixture.id });
    await expect(db.resource.findUnique({ where: { id: fixture.id } })).resolves.toMatchObject({
      ownerDeletionRequestedAt: expect.any(Date),
      status: 'ARCHIVED',
    });
    await expect(
      db.storageDeletionJob.count({ where: { storageKey: fixture.storageKey } }),
    ).resolves.toBe(0);
  });

  it('rejects cross-user deletion without creating a storage job', async () => {
    const fixture = await createResourceFixture('PUBLISHED');

    await expect(
      deleteOwnedContent(
        db as unknown as ContentAdapter,
        { ...actor(), id: otherId },
        'resource',
        fixture.id,
      ),
    ).rejects.toBeInstanceOf(ContentNotFoundError);
    await expect(
      db.storageDeletionJob.count({ where: { storageKey: fixture.storageKey } }),
    ).resolves.toBe(0);
  });
});
