import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleCreateJob } from '@/app/api/jobs/route';
import { createDbClient } from '@/lib/db';
import {
  type ContentAdapter,
  ContentConflictError,
  createJobPost,
  createMarketplaceItem,
  createResource,
  listPublicContent,
} from '@/lib/domain/content-service';

const describeWithDatabase = describe.skipIf(!process.env.DATABASE_URL);

describeWithDatabase('content publishing actions', () => {
  let db: ReturnType<typeof createDbClient>;
  let campusId = '';
  let studentId = '';
  let otherId = '';

  beforeAll(async () => {
    db = createDbClient();
    const suffix = randomUUID();
    const campus = await db.campus.create({
      data: {
        allowedEmailDomain: `${suffix}.content.test`,
        name: 'Content Integration Campus',
        slug: `content-${suffix}`,
      },
    });
    campusId = campus.id;
    const [student, other] = await Promise.all([
      db.user.create({
        data: {
          campusId,
          email: `student@${suffix}.content.test`,
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      }),
      db.user.create({
        data: {
          campusId,
          email: `other@${suffix}.content.test`,
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      }),
    ]);
    studentId = student.id;
    otherId = other.id;
  });

  afterAll(async () => {
    if (campusId) await db.campus.delete({ where: { id: campusId } });
    await db.$disconnect();
  });

  it('moves verified student resource, market, and job submissions to PENDING atomically', async () => {
    const [document, image] = await Promise.all([
      db.asset.create({
        data: {
          contentType: 'application/pdf',
          kind: 'RESOURCE_DOCUMENT',
          ownerId: studentId,
          sizeBytes: 10,
          status: 'READY',
          storageKey: `content/${randomUUID()}`,
        },
      }),
      db.asset.create({
        data: {
          contentType: 'image/jpeg',
          kind: 'MARKETPLACE_IMAGE',
          ownerId: studentId,
          sizeBytes: 10,
          status: 'READY',
          storageKey: `content/${randomUUID()}`,
        },
      }),
    ]);
    const adapter = db as unknown as ContentAdapter;
    const actor = { campusId, id: studentId, role: 'STUDENT' as const };
    const resource = await createResource(adapter, actor, {
      assetIds: [document.id],
      courseCode: undefined,
      summary: 'Complete lecture notes with worked examples and exercises.',
      tags: ['algorithms'],
      title: 'Algorithms revision notes',
    });
    const marketplace = await createMarketplaceItem(adapter, actor, {
      assetIds: [image.id],
      condition: 'GOOD',
      contact: 'Private campus inbox',
      description: 'A carefully used discrete mathematics textbook.',
      pickupArea: 'North library',
      priceCents: 1999,
      title: 'Discrete mathematics textbook',
    });
    const job = await createJobPost(adapter, actor, {
      company: 'Campus Cafe',
      description: 'Help serve students during the weekend lunch shift.',
      location: 'Student centre',
      payText: '$20/hour',
      title: 'Weekend assistant',
    });
    expect([resource.status, marketplace.status, job.status]).toEqual([
      'PENDING',
      'PENDING',
      'PENDING',
    ]);
    await expect(
      db.asset.findUnique({ where: { id: document.id } }),
    ).resolves.toMatchObject({ resourceId: resource.id });
    await expect(
      db.asset.findUnique({ where: { id: image.id } }),
    ).resolves.toMatchObject({ marketplaceItemId: marketplace.id });
  });

  it('denies unverified route actors and assets owned by another user', async () => {
    const response = await handleCreateJob(
      new Request('http://localhost/api/jobs', {
        body: JSON.stringify({
          company: 'Campus Cafe',
          description: 'Help serve students during the weekend lunch shift.',
          location: 'Campus',
          payText: '$20/hour',
          title: 'Weekend assistant',
        }),
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
        },
        method: 'POST',
      }),
      {
        resolveUser: async () => ({
          campusId,
          email: 'pending@example.test',
          emailVerifiedAt: null,
          id: otherId,
          name: null,
          role: 'STUDENT',
          status: 'PENDING_VERIFICATION',
        }),
      },
    );
    expect(response.status).toBe(403);

    const otherDocument = await db.asset.create({
      data: {
        contentType: 'application/pdf',
        kind: 'RESOURCE_DOCUMENT',
        ownerId: otherId,
        sizeBytes: 10,
        status: 'READY',
        storageKey: `content/${randomUUID()}`,
      },
    });
    await expect(
      createResource(
        db as unknown as ContentAdapter,
        { campusId, id: studentId, role: 'STUDENT' },
        {
          assetIds: [otherDocument.id],
          courseCode: undefined,
          summary: 'Complete lecture notes with worked examples and exercises.',
          tags: [],
          title: 'Wrong owner notes',
        },
      ),
    ).rejects.toBeInstanceOf(ContentConflictError);
  });

  it('returns only approved public records and excludes marketplace contact', async () => {
    const pending = await db.resource.findFirstOrThrow({
      where: { authorId: studentId, status: 'PENDING' },
    });
    await db.resource.update({
      data: { status: 'PUBLISHED' },
      where: { id: pending.id },
    });
    const result = await listPublicContent(
      db as unknown as ContentAdapter,
      'resource',
      { page: 1, pageSize: 20 },
    );
    expect(result.items.some((item) => item.id === pending.id)).toBe(true);
    expect(result.items.every((item) => item.status === 'PUBLISHED')).toBe(
      true,
    );

    const market = await listPublicContent(
      db as unknown as ContentAdapter,
      'marketplace',
      { page: 1, pageSize: 20 },
    );
    expect(market.items.every((item) => !Object.hasOwn(item, 'contact'))).toBe(
      true,
    );
  });
});
