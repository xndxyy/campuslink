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
  archiveOwnedContent,
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
  submitOwnedDraft,
} from '@/lib/domain/content-service';

const describeWithDatabase = describe.skipIf(!process.env.DATABASE_URL);

describeWithDatabase('content publishing actions', () => {
  let db: ReturnType<typeof createDbClient>;
  let campusId = '';
  let studentId = '';
  let otherId = '';
  let previousDefaultCampusSlug: string | undefined;
  let hasCampusWorkCapabilities = false;
  const campusWorkProbeRollback = new Error('Rollback CampusWork probe');

  function requireCampusWorkCapabilities(context: TestContext) {
    if (hasCampusWorkCapabilities) return true;
    context.skip();
    return false;
  }

  async function expectCampusWorkPairSynchronized(id: string) {
    const [legacy, campusWork] = await Promise.all([
      db.jobPost.findUniqueOrThrow({ where: { id } }),
      db.campusWorkPost.findUniqueOrThrow({ where: { id } }),
    ]);
    expect(campusWork).toMatchObject({
      authorId: legacy.authorId,
      campusId: legacy.campusId,
      company: legacy.company,
      createdAt: legacy.createdAt,
      description: legacy.description,
      location: legacy.location,
      payText: legacy.payText,
      status: legacy.status,
      title: legacy.title,
      updatedAt: legacy.updatedAt,
    });
  }

  async function runCampusWorkSyncProbe() {
    const id = `campus-work-probe-${randomUUID()}`;
    const createdAt = new Date();
    try {
      await db.$transaction(async (tx) => {
        await tx.jobPost.create({
          data: {
            authorId: studentId,
            campusId,
            company: 'CampusWork probe',
            createdAt,
            description: 'Probe INSERT synchronization.',
            id,
            location: 'Probe location',
            payText: 'Probe pay',
            status: 'DRAFT',
            title: 'CampusWork synchronization probe',
            updatedAt: createdAt,
          },
        });
        const inserted = await tx.campusWorkPost.findUniqueOrThrow({
          where: { id },
        });
        expect(inserted).toMatchObject({
          authorId: studentId,
          campusId,
          company: 'CampusWork probe',
          createdAt,
          description: 'Probe INSERT synchronization.',
          location: 'Probe location',
          payText: 'Probe pay',
          status: 'DRAFT',
          title: 'CampusWork synchronization probe',
          updatedAt: createdAt,
        });

        const updatedAt = new Date(createdAt.getTime() + 1_000);
        const updated = await tx.jobPost.update({
          data: {
            company: 'CampusWork probe updated',
            description: 'Probe UPDATE synchronization.',
            location: 'Updated probe location',
            payText: 'Updated probe pay',
            status: 'PUBLISHED',
            title: 'Updated CampusWork synchronization probe',
            updatedAt,
          },
          where: { id },
        });
        const synchronized = await tx.campusWorkPost.findUniqueOrThrow({
          where: { id },
        });
        expect(synchronized).toMatchObject({
          authorId: updated.authorId,
          campusId: updated.campusId,
          company: updated.company,
          createdAt: updated.createdAt,
          description: updated.description,
          location: updated.location,
          payText: updated.payText,
          status: updated.status,
          title: updated.title,
          updatedAt: updated.updatedAt,
        });

        await tx.jobPost.delete({ where: { id } });
        await expect(
          tx.campusWorkPost.findUnique({ where: { id } }),
        ).resolves.toBeNull();
        throw campusWorkProbeRollback;
      });
    } catch (error) {
      if (error !== campusWorkProbeRollback) throw error;
    }
  }

  beforeAll(async () => {
    db = createDbClient();
    previousDefaultCampusSlug = process.env.DEFAULT_CAMPUS_SLUG;
    const capabilities = await db.$queryRaw<
      Array<{
        functionDefinition: string | null;
        functionName: string | null;
        functionSchema: string | null;
        hasCampusWorkPost: boolean;
        hasCampusWorkTag: boolean;
        hasSyncTrigger: boolean;
        triggerDefinition: string | null;
        triggerEnabled: string | null;
        triggerType: number | null;
      }>
    >`
      SELECT
        to_regclass('public."CampusWorkPost"') IS NOT NULL AS "hasCampusWorkPost",
        to_regclass('public."CampusWorkTag"') IS NOT NULL AS "hasCampusWorkTag",
        synchronization.trigger_oid IS NOT NULL AS "hasSyncTrigger",
        synchronization.tgenabled AS "triggerEnabled",
        synchronization.tgtype AS "triggerType",
        synchronization.function_schema AS "functionSchema",
        synchronization.function_name AS "functionName",
        synchronization.trigger_definition AS "triggerDefinition",
        synchronization.function_definition AS "functionDefinition"
      FROM (SELECT 1) AS singleton
      LEFT JOIN LATERAL (
          SELECT
            trigger.oid AS trigger_oid,
            trigger.tgenabled::text AS tgenabled,
            trigger.tgtype::int AS tgtype,
            function_namespace.nspname AS function_schema,
            function.proname AS function_name,
            pg_catalog.pg_get_triggerdef(trigger.oid, true) AS trigger_definition,
            pg_catalog.pg_get_functiondef(trigger.tgfoid) AS function_definition
          FROM pg_catalog.pg_trigger AS trigger
          JOIN pg_catalog.pg_proc AS function
            ON function.oid = trigger.tgfoid
          JOIN pg_catalog.pg_namespace AS function_namespace
            ON function_namespace.oid = function.pronamespace
          WHERE trigger.tgname = 'JobPost_campus_work_sync'
            AND trigger.tgrelid = to_regclass('public."JobPost"')
            AND NOT trigger.tgisinternal
          ORDER BY trigger.oid
          LIMIT 1
      ) AS synchronization ON true
    `;
    const capability = capabilities[0];
    if (!capability) throw new Error('CampusWork capability query failed.');
    const campusWorkSchemaAbsent =
      !capability.hasCampusWorkPost &&
      !capability.hasCampusWorkTag &&
      !capability.hasSyncTrigger;
    if (campusWorkSchemaAbsent) {
      hasCampusWorkCapabilities = false;
    } else {
      const triggerDefinition = capability.triggerDefinition ?? '';
      const functionDefinition = capability.functionDefinition ?? '';
      const requiredFunctionFragments = [
        "TG_OP = 'DELETE'",
        "'CampusWorkPost'",
        'ON CONFLICT ("id") DO UPDATE SET',
        '"authorId" = EXCLUDED."authorId"',
        '"campusId" = EXCLUDED."campusId"',
        '"company" = EXCLUDED."company"',
        '"title" = EXCLUDED."title"',
        '"description" = EXCLUDED."description"',
        '"location" = EXCLUDED."location"',
        '"payText" = EXCLUDED."payText"',
        '"status" = EXCLUDED."status"',
        '"createdAt" = EXCLUDED."createdAt"',
        '"updatedAt" = EXCLUDED."updatedAt"',
      ];
      const capabilityDrift =
        !capability.hasCampusWorkPost ||
        !capability.hasCampusWorkTag ||
        !capability.hasSyncTrigger ||
        capability.triggerEnabled !== 'O' ||
        capability.triggerType !== 29 ||
        capability.functionSchema !== 'public' ||
        capability.functionName !== '_sync_job_post_to_campus_work' ||
        !triggerDefinition.includes('FOR EACH ROW') ||
        !triggerDefinition.includes('_sync_job_post_to_campus_work()') ||
        requiredFunctionFragments.some(
          (fragment) => !functionDefinition.includes(fragment),
        );
      if (capabilityDrift) {
        throw new Error('CampusWork capability drift detected.');
      }
      hasCampusWorkCapabilities = true;
    }
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
    if (hasCampusWorkCapabilities) await runCampusWorkSyncProbe();
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

  it('keeps owner and legacy CampusWork writes deadlock-safe and synchronized', async (context) => {
    if (!requireCampusWorkCapabilities(context)) return;
    const actor = {
      campusId,
      emailVerifiedAt: new Date(),
      id: studentId,
      role: 'STUDENT' as const,
      status: 'ACTIVE' as const,
    };

    for (const scenario of ['edit', 'archive', 'submit'] as const) {
      const created = await createCampusWorkPost(
        db as unknown as ContentAdapter,
        actor,
        {
          contact: `concurrent-${scenario}-${randomUUID()}@example.test`,
          customTags: [],
          description: `Concurrent ${scenario} synchronization coverage.`,
          location: 'Student centre',
          payText: '30 CNY per hour',
          presetTagIds: [],
          title: `Concurrent ${scenario} ${randomUUID()}`,
        },
      );
      if (scenario !== 'archive') {
        await db.jobPost.update({
          data: { status: scenario === 'edit' ? 'REJECTED' : 'DRAFT' },
          where: { id: created.id },
        });
      }

      let signalOwnerReached!: () => void;
      const ownerReached = new Promise<void>((resolve) => {
        signalOwnerReached = resolve;
      });
      let releaseOwner!: () => void;
      const ownerMayWrite = new Promise<void>((resolve) => {
        releaseOwner = resolve;
      });
      const ownerAdapter = {
        $transaction: <T>(
          operation: (tx: ContentAdapter) => Promise<T>,
          options?: { isolationLevel: 'Serializable' },
        ) =>
          db.$transaction(async (tx) => {
            const transactionalAdapter = {
              asset: tx.asset,
              campusWorkPost: tx.campusWorkPost,
              campusWorkTag: tx.campusWorkTag,
              jobPost: {
                updateMany: async (args: Record<string, unknown>) => {
                  signalOwnerReached();
                  await ownerMayWrite;
                  return tx.jobPost.updateMany(args as never);
                },
              },
              marketplaceItem: tx.marketplaceItem,
              marketplaceTag: tx.marketplaceTag,
              resource: tx.resource,
              resourceTag: tx.resourceTag,
              tagDefinition: tx.tagDefinition,
            } as unknown as ContentAdapter;
            return operation(transactionalAdapter);
          }, options),
        asset: db.asset,
        campusWorkPost: db.campusWorkPost,
        campusWorkTag: db.campusWorkTag,
        jobPost: db.jobPost,
        marketplaceItem: db.marketplaceItem,
        marketplaceTag: db.marketplaceTag,
        resource: db.resource,
        resourceTag: db.resourceTag,
        tagDefinition: db.tagDefinition,
      } as unknown as ContentAdapter;

      const ownerWrite =
        scenario === 'edit'
          ? editOwnedContent(ownerAdapter, actor, 'campus-work', created.id, {
              contact: `revised-${randomUUID()}@example.test`,
              customTags: [],
              description: 'Owner edit won without reversing row lock order.',
              location: 'Campus library',
              payText: '35 CNY per hour',
              presetTagIds: [],
              title: `Owner revised ${randomUUID()}`,
            })
          : scenario === 'archive'
            ? archiveOwnedContent(
                ownerAdapter,
                actor,
                'campus-work',
                created.id,
              )
            : submitOwnedDraft(ownerAdapter, actor, 'campus-work', created.id);
      await ownerReached;

      let signalLegacyLocked!: () => void;
      const legacyLocked = new Promise<void>((resolve) => {
        signalLegacyLocked = resolve;
      });
      let releaseLegacy!: () => void;
      const legacyMayWrite = new Promise<void>((resolve) => {
        releaseLegacy = resolve;
      });
      const legacyWrite = db.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM "JobPost" WHERE id = ${created.id} FOR UPDATE
        `;
        signalLegacyLocked();
        await legacyMayWrite;
        return tx.jobPost.update({
          data: { title: `Legacy concurrent ${scenario} ${randomUUID()}` },
          where: { id: created.id },
        });
      });
      await legacyLocked;
      releaseLegacy();
      await new Promise<void>((resolve) => setImmediate(resolve));
      releaseOwner();

      const outcomes = await Promise.allSettled([ownerWrite, legacyWrite]);
      expect(outcomes).toEqual([
        expect.objectContaining({ status: 'fulfilled' }),
        expect.objectContaining({ status: 'fulfilled' }),
      ]);
      await expectCampusWorkPairSynchronized(created.id);
    }
  }, 30_000);

  it('uses every CampusWork trigram index for public search', async (context) => {
    if (!requireCampusWorkCapabilities(context)) return;
    const searchIndexes = [
      ['title', 'CampusWorkPost_title_trgm_idx'],
      ['description', 'CampusWorkPost_description_trgm_idx'],
      ['location', 'CampusWorkPost_location_trgm_idx'],
      ['payText', 'CampusWorkPost_payText_trgm_idx'],
    ] as const;
    const metadata = await db.$queryRaw<
      Array<{
        attributes: number;
        column: string;
        indexName: string;
        keys: number;
        method: string;
        operatorClass: string;
        ready: boolean;
        valid: boolean;
      }>
    >`
      SELECT
        index_relation.relname AS "indexName",
        attribute.attname AS "column",
        access_method.amname AS method,
        operator_class.opcname AS "operatorClass",
        index_metadata.indisvalid AS valid,
        index_metadata.indisready AS ready,
        index_metadata.indnatts::int AS attributes,
        index_metadata.indnkeyatts::int AS keys
      FROM pg_catalog.pg_index AS index_metadata
      JOIN pg_catalog.pg_class AS table_relation
        ON table_relation.oid = index_metadata.indrelid
      JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.oid = index_metadata.indexrelid
      JOIN pg_catalog.pg_am AS access_method
        ON access_method.oid = index_relation.relam
      JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = table_relation.oid
       AND attribute.attnum = index_metadata.indkey[0]
      JOIN pg_catalog.pg_opclass AS operator_class
        ON operator_class.oid = index_metadata.indclass[0]
      WHERE table_relation.oid = to_regclass('public."CampusWorkPost"')
        AND index_relation.relname IN (
          'CampusWorkPost_title_trgm_idx',
          'CampusWorkPost_description_trgm_idx',
          'CampusWorkPost_location_trgm_idx',
          'CampusWorkPost_payText_trgm_idx'
        )
      ORDER BY index_relation.relname
    `;
    expect(metadata).toEqual(
      searchIndexes
        .map(([column, indexName]) => ({
          attributes: 1,
          column,
          indexName,
          keys: 1,
          method: 'gin',
          operatorClass: 'gin_trgm_ops',
          ready: true,
          valid: true,
        }))
        .sort((left, right) => left.indexName.localeCompare(right.indexName)),
    );

    for (const [field, indexName] of searchIndexes) {
      const plan = await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        return tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
          `EXPLAIN (COSTS OFF)
           SELECT id FROM "CampusWorkPost" WHERE "${field}" ILIKE $1`,
          '%probe%',
        );
      });
      expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain(
        indexName,
      );
    }
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
