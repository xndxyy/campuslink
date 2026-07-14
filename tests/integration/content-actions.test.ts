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
  editOwnedContent,
  getOwnedContent,
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
    if (campusId) {
      await db.user.deleteMany({ where: { campusId } });
      await db.tagDefinition.deleteMany({ where: { campusId } });
      await db.campus.delete({ where: { id: campusId } });
    }
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
    const actor = {
      campusId,
      emailVerifiedAt: new Date(),
      id: studentId,
      role: 'STUDENT' as const,
      status: 'ACTIVE' as const,
    };
    const resource = await createResource(adapter, actor, {
      assetIds: [document.id],
      customTags: ['算法'],
      presetTagIds: [],
      summary: 'Complete lecture notes with worked examples and exercises.',
      title: 'Algorithms revision notes',
    });
    const marketplace = await createMarketplaceItem(adapter, actor, {
      assetIds: [image.id],
      condition: 'GOOD',
      contact: 'Private campus inbox',
      customTags: ['教材'],
      description: 'A carefully used discrete mathematics textbook.',
      pickupArea: 'North library',
      presetTagIds: [],
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
        {
          campusId,
          emailVerifiedAt: new Date(),
          id: studentId,
          role: 'STUDENT',
          status: 'ACTIVE',
        },
        {
          assetIds: [otherDocument.id],
          customTags: [],
          presetTagIds: [],
          summary: 'Complete lecture notes with worked examples and exercises.',
          title: 'Wrong owner notes',
        },
      ),
    ).rejects.toBeInstanceOf(ContentConflictError);
  });

  it('rolls back the asset binding, content, custom tag, and joins together', async () => {
    const document = await db.asset.create({
      data: {
        contentType: 'application/pdf',
        kind: 'RESOURCE_DOCUMENT',
        ownerId: studentId,
        sizeBytes: 10,
        status: 'READY',
        storageKey: `content/${randomUUID()}`,
      },
    });
    const title = `Rollback resource ${randomUUID()}`;
    const customTag = `Rollback ${randomUUID().slice(0, 8)}`;
    const failingAdapter = {
      ...db,
      $transaction: <T>(
        operation: (tx: ContentAdapter) => Promise<T>,
        options?: { isolationLevel: 'Serializable' },
      ) =>
        db.$transaction(async (tx) => {
          const transactionalAdapter = {
            asset: {
              findMany: (args: { where: { id: { in: string[] } } }) =>
                tx.asset.findMany(args),
              updateMany: async (args: {
                data: { marketplaceItemId?: string; resourceId?: string };
                where: Record<string, unknown>;
              }) => {
                await tx.asset.updateMany(args as never);
                return { count: 0 };
              },
            },
            jobPost: tx.jobPost,
            marketplaceItem: tx.marketplaceItem,
            marketplaceTag: tx.marketplaceTag,
            resource: tx.resource,
            resourceTag: tx.resourceTag,
            tagDefinition: tx.tagDefinition,
          } as unknown as ContentAdapter;
          return operation(transactionalAdapter);
        }, options),
    } as unknown as ContentAdapter;

    await expect(
      createResource(
        failingAdapter,
        {
          campusId,
          emailVerifiedAt: new Date(),
          id: studentId,
          role: 'STUDENT',
          status: 'ACTIVE',
        },
        {
          assetIds: [document.id],
          customTags: [customTag],
          presetTagIds: [],
          summary:
            'This controlled failure verifies complete transaction rollback.',
          title,
        },
      ),
    ).rejects.toBeInstanceOf(ContentConflictError);

    await expect(
      db.resource.findFirst({ where: { title } }),
    ).resolves.toBeNull();
    await expect(
      db.tagDefinition.findFirst({
        where: { campusId, label: customTag, scope: 'RESOURCE' },
      }),
    ).resolves.toBeNull();
    await expect(
      db.resourceTag.count({ where: { resource: { title } } }),
    ).resolves.toBe(0);
    await expect(
      db.asset.findUnique({ where: { id: document.id } }),
    ).resolves.toMatchObject({ resourceId: null });
  });

  it('atomically replaces joins and still presents an inactive historical tag', async () => {
    const [firstTag, secondTag] = await Promise.all([
      db.tagDefinition.create({
        data: {
          campusId,
          isPreset: true,
          label: `Preset A ${randomUUID().slice(0, 6)}`,
          scope: 'RESOURCE',
          slug: `preset-a-${randomUUID()}`.slice(0, 40),
        },
      }),
      db.tagDefinition.create({
        data: {
          campusId,
          isPreset: true,
          label: `Preset B ${randomUUID().slice(0, 6)}`,
          scope: 'RESOURCE',
          slug: `preset-b-${randomUUID()}`.slice(0, 40),
        },
      }),
    ]);
    const resource = await db.resource.create({
      data: {
        authorId: studentId,
        campusId,
        status: 'DRAFT',
        summary: 'Draft resource used to verify atomic tag replacement.',
        title: `Editable resource ${randomUUID()}`,
      },
    });
    await db.resourceTag.create({
      data: {
        campusId,
        resourceId: resource.id,
        scope: 'RESOURCE',
        tagId: firstTag.id,
      },
    });
    const actor = {
      campusId,
      emailVerifiedAt: new Date(),
      id: studentId,
      role: 'STUDENT' as const,
      status: 'ACTIVE' as const,
    };

    await editOwnedContent(
      db as unknown as ContentAdapter,
      actor,
      'resource',
      resource.id,
      {
        customTags: [],
        presetTagIds: [secondTag.id],
        summary: 'Revised resource used to verify atomic tag replacement.',
        title: resource.title,
      },
    );
    await expect(
      db.resourceTag.findMany({
        select: { tagId: true },
        where: { resourceId: resource.id },
      }),
    ).resolves.toEqual([{ tagId: secondTag.id }]);

    await db.tagDefinition.update({
      data: { isActive: false },
      where: { id: secondTag.id },
    });
    await expect(
      getOwnedContent(
        db as unknown as ContentAdapter,
        actor,
        'resource',
        resource.id,
      ),
    ).resolves.toMatchObject({
      tags: [expect.objectContaining({ id: secondTag.id, isActive: false })],
    });
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
