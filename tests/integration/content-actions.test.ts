import { randomUUID } from 'node:crypto';

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  type TestContext,
} from 'vitest';

import { handleCreateJob } from '@/app/api/jobs/route';
import { createDbClient } from '@/lib/db';
import {
  requestCampusWorkContact,
  type CampusWorkContactAdapter,
} from '@/lib/domain/campus-work-contact';
import {
  type ContentAdapter,
  ContentConflictError,
  createCampusWorkPost,
  createJobPost,
  createMarketplaceItem,
  createResource,
  editOwnedContent,
  getOwnedContent,
  getPublicContent,
  listPublicContent,
} from '@/lib/domain/content-service';

const describeWithDatabase = describe.skipIf(!process.env.DATABASE_URL);

describeWithDatabase('content publishing actions', () => {
  let db: ReturnType<typeof createDbClient>;
  let campusId = '';
  let studentId = '';
  let otherId = '';
  let previousDefaultCampusSlug: string | undefined;
  let hasCampusWorkCapabilities = false;

  function requireCampusWorkCapabilities(context: TestContext) {
    if (hasCampusWorkCapabilities) return true;
    context.skip();
    return false;
  }

  beforeAll(async () => {
    db = createDbClient();
    previousDefaultCampusSlug = process.env.DEFAULT_CAMPUS_SLUG;
    const capabilities = await db.$queryRaw<
      Array<{ hasCampusWorkCapabilities: boolean }>
    >`
      SELECT
        to_regclass('public."CampusWorkPost"') IS NOT NULL
        AND to_regclass('public."CampusWorkTag"') IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_trigger AS trigger
          JOIN pg_catalog.pg_proc AS function
            ON function.oid = trigger.tgfoid
          JOIN pg_catalog.pg_namespace AS function_namespace
            ON function_namespace.oid = function.pronamespace
          CROSS JOIN LATERAL (
            SELECT
              pg_catalog.pg_get_triggerdef(trigger.oid, true) AS trigger_definition,
              pg_catalog.pg_get_functiondef(trigger.tgfoid) AS function_definition
          ) AS definitions
          WHERE trigger.tgname = 'JobPost_campus_work_sync'
            AND trigger.tgrelid = to_regclass('public."JobPost"')
            AND NOT trigger.tgisinternal
            AND trigger.tgenabled = 'O'
            AND trigger.tgtype = 29
            AND function_namespace.nspname = 'public'
            AND function.proname = '_sync_job_post_to_campus_work'
            AND definitions.trigger_definition
              LIKE '%FOR EACH ROW EXECUTE FUNCTION%'
            AND definitions.trigger_definition
              LIKE '%_sync_job_post_to_campus_work()%'
            AND definitions.function_definition LIKE '%TG_OP = ''DELETE''%'
            AND definitions.function_definition LIKE '%''CampusWorkPost''%'
            AND definitions.function_definition
              LIKE '%ON CONFLICT ("id") DO UPDATE SET%'
            AND definitions.function_definition LIKE ALL (ARRAY[
              '%"authorId" = EXCLUDED."authorId"%',
              '%"campusId" = EXCLUDED."campusId"%',
              '%"company" = EXCLUDED."company"%',
              '%"title" = EXCLUDED."title"%',
              '%"description" = EXCLUDED."description"%',
              '%"location" = EXCLUDED."location"%',
              '%"payText" = EXCLUDED."payText"%',
              '%"status" = EXCLUDED."status"%',
              '%"createdAt" = EXCLUDED."createdAt"%',
              '%"updatedAt" = EXCLUDED."updatedAt"%'
            ])
        ) AS "hasCampusWorkCapabilities"
    `;
    hasCampusWorkCapabilities =
      capabilities[0]?.hasCampusWorkCapabilities === true;
    const suffix = randomUUID();
    const campus = await db.campus.create({
      data: {
        allowedEmailDomain: `${suffix}.content.test`,
        name: 'Content Integration Campus',
        slug: `content-${suffix}`,
      },
    });
    campusId = campus.id;
    process.env.DEFAULT_CAMPUS_SLUG = campus.slug;
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
    try {
      if (campusId) {
        await db.auditLog.deleteMany({ where: { campusId } });
        await db.user.deleteMany({ where: { campusId } });
        await db.tagDefinition.deleteMany({ where: { campusId } });
        await db.campus.delete({ where: { id: campusId } });
      }
    } finally {
      if (previousDefaultCampusSlug === undefined) {
        delete process.env.DEFAULT_CAMPUS_SLUG;
      } else {
        process.env.DEFAULT_CAMPUS_SLUG = previousDefaultCampusSlug;
      }
      await db.$disconnect();
    }
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

  it('dual-writes campus work and preserves contact and tags through a legacy trigger update', async (context) => {
    if (!requireCampusWorkCapabilities(context)) return;
    const customTag = `现场协助 ${randomUUID().slice(0, 6)}`;
    const contact = `contact-${randomUUID()}@example.test`;
    const actor = {
      campusId,
      emailVerifiedAt: new Date(),
      id: studentId,
      role: 'STUDENT' as const,
      status: 'ACTIVE' as const,
    };
    const created = await createCampusWorkPost(
      db as unknown as ContentAdapter,
      actor,
      {
        contact,
        customTags: [customTag],
        description:
          'This campus work record verifies atomic legacy compatibility.',
        location: 'Student centre',
        payText: '30 CNY per hour',
        presetTagIds: [],
        title: `Campus work ${randomUUID()}`,
      },
    );

    const [campusWork, legacy] = await Promise.all([
      db.campusWorkPost.findUniqueOrThrow({ where: { id: created.id } }),
      db.jobPost.findUniqueOrThrow({ where: { id: created.id } }),
    ]);
    expect(campusWork).toMatchObject({
      authorId: legacy.authorId,
      campusId: legacy.campusId,
      description: legacy.description,
      location: legacy.location,
      payText: legacy.payText,
      status: legacy.status,
      title: legacy.title,
    });
    expect(campusWork.company).toBe('CampusLink 校园工作');
    expect(legacy.company).toBe('CampusLink 校园工作');
    expect(campusWork.createdAt).toEqual(legacy.createdAt);
    expect(campusWork.updatedAt).toEqual(legacy.updatedAt);

    const revisedTitle = `Legacy revised ${randomUUID()}`;
    await db.jobPost.update({
      data: { status: 'PUBLISHED', title: revisedTitle },
      where: { id: created.id },
    });
    await expect(
      db.campusWorkPost.findUnique({
        include: { tagAssignments: { include: { tag: true } } },
        where: { id: created.id },
      }),
    ).resolves.toMatchObject({
      contact,
      status: 'PUBLISHED',
      tagAssignments: [
        expect.objectContaining({
          tag: expect.objectContaining({ label: customTag }),
        }),
      ],
      title: revisedTitle,
    });
  });

  it('rolls back campus work, legacy, custom tag, and join when a join write fails', async (context) => {
    if (!requireCampusWorkCapabilities(context)) return;
    const title = `Rollback campus work ${randomUUID()}`;
    const customTag = `Rollback work ${randomUUID().slice(0, 6)}`;
    const failingAdapter = {
      ...db,
      $transaction: <T>(
        operation: (tx: ContentAdapter) => Promise<T>,
        options?: { isolationLevel: 'Serializable' },
      ) =>
        db.$transaction(async (tx) => {
          const transactionalAdapter = {
            campusWorkPost: tx.campusWorkPost,
            campusWorkTag: {
              createMany: async (args: {
                data: Array<{
                  campusId: string;
                  campusWorkPostId: string;
                  scope: 'CAMPUS_WORK';
                  tagId: string;
                }>;
              }) => {
                await tx.campusWorkTag.createMany(args);
                return { count: 0 };
              },
              deleteMany: (args: Record<string, unknown>) =>
                tx.campusWorkTag.deleteMany(args as never),
            },
            jobPost: tx.jobPost,
            tagDefinition: tx.tagDefinition,
          } as unknown as ContentAdapter;
          return operation(transactionalAdapter);
        }, options),
    } as unknown as ContentAdapter;

    await expect(
      createCampusWorkPost(
        failingAdapter,
        {
          campusId,
          emailVerifiedAt: new Date(),
          id: studentId,
          role: 'STUDENT',
          status: 'ACTIVE',
        },
        {
          contact: 'rollback@example.test',
          customTags: [customTag],
          description:
            'This controlled failure verifies full dual-write rollback.',
          location: 'Student centre',
          payText: '30 CNY per hour',
          presetTagIds: [],
          title,
        },
      ),
    ).rejects.toBeInstanceOf(ContentConflictError);

    await expect(
      db.campusWorkPost.findFirst({ where: { title } }),
    ).resolves.toBeNull();
    await expect(
      db.jobPost.findFirst({ where: { title } }),
    ).resolves.toBeNull();
    await expect(
      db.tagDefinition.findFirst({
        where: { campusId, label: customTag, scope: 'CAMPUS_WORK' },
      }),
    ).resolves.toBeNull();
  });

  it('returns contact only after persisting the minimal audit event', async (context) => {
    if (!requireCampusWorkCapabilities(context)) return;
    const contact = `audited-${randomUUID()}@example.test`;
    const created = await createCampusWorkPost(
      db as unknown as ContentAdapter,
      {
        campusId,
        emailVerifiedAt: new Date(),
        id: studentId,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
      {
        contact,
        customTags: [],
        description: 'This published work verifies audited contact disclosure.',
        location: 'Student centre',
        payText: '30 CNY per hour',
        presetTagIds: [],
        title: `Audited campus work ${randomUUID()}`,
      },
    );
    await db.jobPost.update({
      data: { status: 'PUBLISHED' },
      where: { id: created.id },
    });

    await expect(
      requestCampusWorkContact(
        db as unknown as CampusWorkContactAdapter,
        { campusId, id: otherId },
        created.id,
      ),
    ).resolves.toEqual({ contact });
    const audit = await db.auditLog.findFirstOrThrow({
      where: {
        action: 'CAMPUS_WORK_CONTACT_VIEWED',
        actorId: otherId,
        subjectId: created.id,
        subjectType: 'JOB_POST',
      },
    });
    expect(audit.details).toBeNull();
    expect(JSON.stringify(audit)).not.toContain(contact);
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

  it('presents an inactive historical CampusWork tag without leaking public contact', async (context) => {
    if (!requireCampusWorkCapabilities(context)) return;
    const customTag = `Inactive work ${randomUUID().slice(0, 6)}`;
    const contact = `inactive-${randomUUID()}@example.test`;
    const actor = {
      campusId,
      emailVerifiedAt: new Date(),
      id: studentId,
      role: 'STUDENT' as const,
      status: 'ACTIVE' as const,
    };
    const created = await createCampusWorkPost(
      db as unknown as ContentAdapter,
      actor,
      {
        contact,
        customTags: [customTag],
        description:
          'This published work verifies inactive historical tag presentation.',
        location: 'Campus library',
        payText: '25 CNY per hour',
        presetTagIds: [],
        title: `Inactive tag work ${randomUUID()}`,
      },
    );
    const tag = await db.tagDefinition.findFirstOrThrow({
      where: { campusId, label: customTag, scope: 'CAMPUS_WORK' },
    });

    await db.jobPost.update({
      data: { status: 'PUBLISHED' },
      where: { id: created.id },
    });
    await db.tagDefinition.update({
      data: { isActive: false },
      where: { id: tag.id },
    });

    const [publicList, publicDetail, ownerDetail] = await Promise.all([
      listPublicContent(db as unknown as ContentAdapter, 'campus-work', {
        page: 1,
        pageSize: 50,
      }),
      getPublicContent(
        db as unknown as ContentAdapter,
        'campus-work',
        created.id,
      ),
      getOwnedContent(
        db as unknown as ContentAdapter,
        actor,
        'campus-work',
        created.id,
      ),
    ]);
    const publicListItem = publicList.items.find(
      (item) => item.id === created.id,
    );
    if (!publicListItem) throw new Error('CampusWork list item not found');
    if (!publicDetail) throw new Error('CampusWork public detail not found');

    expect(publicListItem).toMatchObject({
      tags: [expect.objectContaining({ id: tag.id, isActive: false })],
    });
    expect(publicDetail).toMatchObject({
      tags: [expect.objectContaining({ id: tag.id, isActive: false })],
    });
    expect(ownerDetail).toMatchObject({
      contact,
      tags: [expect.objectContaining({ id: tag.id, isActive: false })],
    });
    expect(!Object.hasOwn(publicListItem, 'contact')).toBe(true);
    expect(!Object.hasOwn(publicDetail, 'contact')).toBe(true);
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
