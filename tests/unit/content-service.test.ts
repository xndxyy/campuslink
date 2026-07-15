import { describe, expect, it, vi } from 'vitest';

import {
  ContentConflictError,
  type ContentAdapter,
  type ContentPublishingPolicy,
  type ContentRecord,
  createJobPost,
  createMarketplaceItem,
  createResource,
  editOwnedContent,
  getOwnedContent,
  listOwnedContent,
  listPublicContent,
} from '@/lib/domain/content-service';
import {
  ContentBlockedError,
  type PreparedAssessmentBatch,
} from '@/lib/moderation/content-assessment';

const actor = {
  campusId: 'campus_server',
  emailVerifiedAt: new Date('2026-07-14T00:00:00Z'),
  id: 'user_server',
  role: 'STUDENT' as const,
  status: 'ACTIVE' as const,
};

type Asset = {
  id: string;
  kind: 'RESOURCE_DOCUMENT' | 'RESOURCE_IMAGE' | 'MARKETPLACE_IMAGE';
  marketplaceItemId: string | null;
  ownerId: string;
  resourceId: string | null;
  scanStatus?: 'NOT_REQUIRED' | 'PENDING' | 'CLEAN' | 'INFECTED' | 'ERROR';
  status: 'PENDING' | 'READY';
};

function createAdapter(assets: Asset[] = []) {
  const created: Array<Record<string, unknown>> = [];
  let resourceTagRows: Array<Record<string, unknown>> = [];
  let marketplaceTagRows: Array<Record<string, unknown>> = [];
  const adapter = {
    $transaction: vi.fn(
      async <T>(
        operation: (tx: typeof adapter) => Promise<T>,
        options?: { isolationLevel: 'Serializable' },
      ) => {
        void options;
        return operation(adapter);
      },
    ),
    asset: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        assets.filter((asset) => where.id.in.includes(asset.id)),
      ),
      updateMany: vi.fn(async () => ({ count: assets.length })),
    },
    auditLog: { create: vi.fn(async () => ({})) },
    contentAssessment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        id: 'assessment_1',
      })),
    },
    jobPost: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const record = { ...data, id: 'job_1' };
        created.push(record);
        return record;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'job_1',
        ...data,
      })),
    },
    marketplaceItem: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const record = { ...data, id: String(data.id ?? 'market_1') };
        created.push(record);
        return record;
      }),
      update: vi.fn(
        async ({
          data,
          where,
        }: {
          data: Record<string, unknown>;
          where: { id: string };
        }) => ({
          id: where.id,
          ...data,
        }),
      ),
    },
    marketplaceTag: {
      createMany: vi.fn(
        async ({ data }: { data: Record<string, unknown>[] }) => {
          marketplaceTagRows.push(...data);
          return { count: data.length };
        },
      ),
      deleteMany: vi.fn(async () => {
        const count = marketplaceTagRows.length;
        marketplaceTagRows = [];
        return { count };
      }),
    },
    moderationAction: {
      findMany: vi.fn(async () => [
        {
          action: 'APPROVE',
          createdAt: new Date('2026-07-12T12:00:00Z'),
          id: 'decision_2',
          reason: 'Latest approval replaces the earlier rejection note.',
          subjectId: 'r3',
        },
        {
          action: 'REJECT',
          createdAt: new Date('2026-07-12T11:00:00Z'),
          id: 'decision_1',
          reason: 'Older rejection note.',
          subjectId: 'r3',
        },
      ]),
    },
    resource: {
      count: vi.fn(async () => 3),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const record = { ...data, id: String(data.id ?? 'resource_1') };
        created.push(record);
        return record;
      }),
      findMany: vi.fn(async () => [
        {
          createdAt: new Date('2026-07-12T11:00:00Z'),
          id: 'r3',
          status: 'PUBLISHED',
        },
        {
          createdAt: new Date('2026-07-12T10:00:00Z'),
          id: 'r2',
          status: 'PUBLISHED',
        },
      ]),
      findFirst: vi.fn(async (): Promise<ContentRecord | null> => null),
      update: vi.fn(
        async ({
          data,
          where,
        }: {
          data: Record<string, unknown>;
          where: { id: string };
        }) => ({
          id: where.id,
          ...data,
        }),
      ),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    resourceTag: {
      createMany: vi.fn(
        async ({ data }: { data: Record<string, unknown>[] }) => {
          resourceTagRows.push(...data);
          return { count: data.length };
        },
      ),
      deleteMany: vi.fn(async () => {
        const count = resourceTagRows.length;
        resourceTagRows = [];
        return { count };
      }),
    },
    tagDefinition: {
      findMany: vi.fn(
        async ({ where }: { where: { id: { in: string[] }; scope: string } }) =>
          where.id.in.map((id) => ({
            campusId: actor.campusId,
            id,
            isActive: true,
            isPreset: true,
            label: id,
            scope: where.scope,
            slug: id,
          })),
      ),
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(
        async ({ create }: { create: Record<string, unknown> }) => ({
          ...create,
          id: `custom_${String(create.slug)}`,
        }),
      ),
    },
  };
  return {
    adapter,
    created,
    marketplaceTagRows: () => marketplaceTagRows,
    resourceTagRows: () => resourceTagRows,
    serviceAdapter: adapter as unknown as ContentAdapter,
  };
}

function publishingPolicy(
  outcome:
    | { kind: 'pass' }
    | { kind: 'review'; reasonZh: string }
    | {
        categories: string[];
        kind: 'block';
        reasonZh: string;
        source: 'provider';
        suggestionZh: string;
      }
    | { kind: 'skipped' },
) {
  const targetId = 'resource_1';
  const skipped = outcome.kind === 'skipped';
  const prepared = {
    assessments: [
      {
        auditSkipped: skipped,
        data: {
          campusId: actor.campusId,
          decision:
            outcome.kind === 'block'
              ? 'BLOCK'
              : outcome.kind === 'review'
                ? 'REVIEW'
                : 'PASS',
          providerStatus: skipped ? 'SKIPPED' : 'COMPLETED',
          targetId,
          targetType: 'RESOURCE',
        },
        outcome,
        targetId,
        targetType: 'RESOURCE',
      },
    ],
    campusId: actor.campusId,
    outcome,
  } as unknown as PreparedAssessmentBatch;
  return {
    generateTargetId: () => targetId,
    prepare: vi.fn(async () => prepared),
  } satisfies ContentPublishingPolicy;
}

const resourceInput = {
  assetIds: ['doc_1'],
  customTags: ['算法'],
  presetTagIds: [],
  summary: 'Complete lecture notes with worked examples and exercises.',
  title: 'Algorithms revision notes',
};

describe('content service', () => {
  it('publishes a passing resource and assesses custom tags independently', async () => {
    const { adapter, serviceAdapter } = createAdapter([
      {
        id: 'doc_1',
        kind: 'RESOURCE_DOCUMENT',
        marketplaceItemId: null,
        ownerId: actor.id,
        resourceId: null,
        status: 'READY',
      },
    ]);
    const policy = publishingPolicy({ kind: 'pass' });

    const result = await createResource(
      serviceAdapter,
      actor,
      resourceInput,
      undefined,
      policy,
    );

    expect(policy.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        campusId: actor.campusId,
        requests: [
          {
            content: {
              summary: resourceInput.summary,
              title: resourceInput.title,
            },
            targetId: 'resource_1',
            targetType: 'RESOURCE',
          },
          {
            content: { tag: '算法' },
            targetId: 'resource_1:tag:0',
            targetType: 'CUSTOM_TAG',
          },
        ],
      }),
    );
    expect(adapter.resource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: 'resource_1' }),
    });
    expect(adapter.resource.update).toHaveBeenCalledWith({
      data: { status: 'PUBLISHED' },
      where: { id: 'resource_1' },
    });
    expect(adapter.contentAssessment.create).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('PUBLISHED');
  });

  it('keeps reviewed marketplace content pending and excludes contact from AI input', async () => {
    const { adapter, serviceAdapter } = createAdapter([
      {
        id: 'image_1',
        kind: 'MARKETPLACE_IMAGE',
        marketplaceItemId: null,
        ownerId: actor.id,
        resourceId: null,
        status: 'READY',
      },
    ]);
    const policy = publishingPolicy({
      kind: 'review',
      reasonZh: '需要人工确认交易描述',
    });

    const result = await createMarketplaceItem(
      serviceAdapter,
      actor,
      {
        assetIds: ['image_1'],
        condition: 'GOOD',
        contact: 'private-contact@example.com',
        customTags: [],
        description: 'A carefully used discrete mathematics textbook.',
        pickupArea: 'North library',
        presetTagIds: [],
        priceCents: 1999,
        title: 'Discrete mathematics textbook',
      },
      policy,
    );

    const serializedAssessmentInput = JSON.stringify(
      vi.mocked(policy.prepare).mock.calls,
    );
    expect(serializedAssessmentInput).not.toContain('private-contact');
    expect(adapter.marketplaceItem.update).toHaveBeenCalledWith({
      data: { status: 'PENDING' },
      where: { id: 'resource_1' },
    });
    expect(result.status).toBe('PENDING');
  });

  it('persists provider-blocked content as rejected before returning feedback', async () => {
    const { adapter, serviceAdapter } = createAdapter([
      {
        id: 'doc_1',
        kind: 'RESOURCE_DOCUMENT',
        marketplaceItemId: null,
        ownerId: actor.id,
        resourceId: null,
        status: 'READY',
      },
    ]);
    const policy = publishingPolicy({
      categories: ['诈骗引流'],
      kind: 'block',
      reasonZh: '内容包含诱导转账信息',
      source: 'provider',
      suggestionZh: '删除转账诱导后重新提交',
    });

    await expect(
      createResource(serviceAdapter, actor, resourceInput, undefined, policy),
    ).rejects.toMatchObject({
      categories: ['诈骗引流'],
      code: 'CONTENT_BLOCKED',
      reason: '内容包含诱导转账信息',
      suggestion: '删除转账诱导后重新提交',
    } satisfies Partial<ContentBlockedError>);
    expect(adapter.resource.update).toHaveBeenCalledWith({
      data: { status: 'REJECTED' },
      where: { id: 'resource_1' },
    });
    expect(adapter.contentAssessment.create).toHaveBeenCalledTimes(1);
  });

  it('publishes fail-open content and audits the skipped provider in the transaction', async () => {
    const { adapter, serviceAdapter } = createAdapter([
      {
        id: 'doc_1',
        kind: 'RESOURCE_DOCUMENT',
        marketplaceItemId: null,
        ownerId: actor.id,
        resourceId: null,
        status: 'READY',
      },
    ]);
    const policy = publishingPolicy({ kind: 'skipped' });

    await expect(
      createResource(serviceAdapter, actor, resourceInput, undefined, policy),
    ).resolves.toMatchObject({ status: 'PUBLISHED' });
    expect(adapter.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'AI_CHECK_SKIPPED' }),
      }),
    );
  });

  it('rejects a resource without a document with the exact domain message', async () => {
    const { serviceAdapter } = createAdapter([
      {
        id: 'image_1',
        kind: 'RESOURCE_IMAGE',
        marketplaceItemId: null,
        ownerId: actor.id,
        resourceId: null,
        status: 'READY',
      },
    ]);

    await expect(
      createResource(serviceAdapter, actor, {
        ...resourceInput,
        assetIds: ['image_1'],
      }),
    ).rejects.toThrow('Resource requires a document');
  });

  it('rejects a marketplace item without an image', async () => {
    const { serviceAdapter } = createAdapter([]);
    await expect(
      createMarketplaceItem(serviceAdapter, actor, {
        assetIds: ['missing_image'],
        condition: 'GOOD',
        contact: 'Campus inbox only',
        customTags: [],
        description: 'A carefully used discrete mathematics textbook.',
        pickupArea: 'North library',
        presetTagIds: [],
        priceCents: 1999,
        title: 'Discrete mathematics textbook',
      }),
    ).rejects.toBeInstanceOf(ContentConflictError);
  });

  it.each([
    ['wrong owner', { ownerId: 'another_user' }],
    ['wrong status', { status: 'PENDING' as const }],
    ['wrong kind', { kind: 'MARKETPLACE_IMAGE' as const }],
  ])('rejects an asset with %s', async (_name, override) => {
    const { serviceAdapter } = createAdapter([
      {
        id: 'doc_1',
        kind: 'RESOURCE_DOCUMENT',
        marketplaceItemId: null,
        ownerId: actor.id,
        resourceId: null,
        status: 'READY',
        ...override,
      },
    ]);
    await expect(
      createResource(serviceAdapter, actor, resourceInput),
    ).rejects.toBeInstanceOf(ContentConflictError);
  });

  it('creates, attaches, and submits a resource in one transaction', async () => {
    const { adapter, resourceTagRows, serviceAdapter } = createAdapter([
      {
        id: 'doc_1',
        kind: 'RESOURCE_DOCUMENT',
        marketplaceItemId: null,
        ownerId: actor.id,
        resourceId: null,
        status: 'READY',
      },
    ]);
    const result = await createResource(serviceAdapter, actor, resourceInput);

    expect(adapter.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(adapter.resource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        authorId: actor.id,
        campusId: actor.campusId,
        status: 'DRAFT',
      }),
    });
    const resourceData = adapter.resource.create.mock.calls[0]?.[0].data;
    expect(resourceData).not.toHaveProperty('courseCode');
    expect(resourceData).not.toHaveProperty('tags');
    expect(adapter.resourceTag.createMany).toHaveBeenCalledWith({
      data: [
        {
          campusId: actor.campusId,
          resourceId: 'resource_1',
          scope: 'RESOURCE',
          tagId: 'custom_算法',
        },
      ],
    });
    expect(resourceTagRows()).toEqual([
      expect.objectContaining({
        resourceId: 'resource_1',
        tagId: 'custom_算法',
      }),
    ]);
    expect(adapter.asset.updateMany).toHaveBeenCalledWith({
      data: { resourceId: 'resource_1' },
      where: {
        id: { in: ['doc_1'] },
        kind: { in: ['RESOURCE_DOCUMENT', 'RESOURCE_IMAGE'] },
        marketplaceItemId: null,
        ownerId: actor.id,
        resourceId: null,
        status: 'READY',
      },
    });
    expect(adapter.resource.update).toHaveBeenCalledWith({
      data: { status: 'PENDING' },
      where: { id: 'resource_1' },
    });
    expect(result.status).toBe('PENDING');
  });

  it('writes marketplace tag joins from the resolved selection', async () => {
    const { adapter, marketplaceTagRows, serviceAdapter } = createAdapter([
      {
        id: 'image_1',
        kind: 'MARKETPLACE_IMAGE',
        marketplaceItemId: null,
        ownerId: actor.id,
        resourceId: null,
        status: 'READY',
      },
    ]);

    await createMarketplaceItem(serviceAdapter, actor, {
      assetIds: ['image_1'],
      condition: 'GOOD',
      contact: 'Campus inbox only',
      customTags: [],
      description: 'A carefully used discrete mathematics textbook.',
      pickupArea: 'North library',
      presetTagIds: ['preset_market'],
      priceCents: 1999,
      title: 'Discrete mathematics textbook',
    });

    expect(adapter.marketplaceTag.createMany).toHaveBeenCalledWith({
      data: [
        {
          campusId: actor.campusId,
          marketplaceItemId: 'market_1',
          scope: 'MARKETPLACE',
          tagId: 'preset_market',
        },
      ],
    });
    expect(marketplaceTagRows()).toHaveLength(1);
  });

  it('atomically replaces every resource tag join during an owned edit', async () => {
    const { adapter, serviceAdapter } = createAdapter();
    await editOwnedContent(serviceAdapter, actor, 'resource', 'resource_1', {
      customTags: [],
      presetTagIds: ['replacement_tag'],
      summary: 'Revised lecture notes with worked examples and exercises.',
      title: 'Revised algorithms notes',
    });

    expect(adapter.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(adapter.resourceTag.deleteMany).toHaveBeenCalledWith({
      where: { resourceId: 'resource_1' },
    });
    expect(adapter.resourceTag.createMany).toHaveBeenCalledWith({
      data: [
        {
          campusId: actor.campusId,
          resourceId: 'resource_1',
          scope: 'RESOURCE',
          tagId: 'replacement_tag',
        },
      ],
    });
    expect(adapter.resource.updateMany).toHaveBeenCalledWith({
      data: {
        status: 'DRAFT',
        summary: 'Revised lecture notes with worked examples and exercises.',
        title: 'Revised algorithms notes',
      },
      where: {
        authorId: actor.id,
        id: 'resource_1',
        status: { in: ['DRAFT', 'REJECTED'] },
      },
    });
  });

  it('whitelists resource update fields when an internal variable carries legacy columns', async () => {
    const { adapter, serviceAdapter } = createAdapter();
    const resourceEditWithLegacyFields = {
      courseCode: 'CS 101',
      customTags: [],
      presetTagIds: ['replacement_tag'],
      summary: 'Revised lecture notes with worked examples and exercises.',
      tags: ['legacy-string-tag'],
      title: 'Revised algorithms notes',
    };

    await editOwnedContent(
      serviceAdapter,
      actor,
      'resource',
      'resource_1',
      resourceEditWithLegacyFields,
    );

    expect(adapter.resource.updateMany).toHaveBeenCalledWith({
      data: {
        status: 'DRAFT',
        summary: resourceEditWithLegacyFields.summary,
        title: resourceEditWithLegacyFields.title,
      },
      where: {
        authorId: actor.id,
        id: 'resource_1',
        status: { in: ['DRAFT', 'REJECTED'] },
      },
    });
  });

  it('whitelists marketplace update fields when an internal variable carries an extra key', async () => {
    const { adapter, serviceAdapter } = createAdapter();
    const marketplaceEditWithExtraField = {
      condition: 'GOOD' as const,
      contact: 'Campus inbox only',
      customTags: [],
      description: 'A carefully revised discrete mathematics textbook.',
      internalOnly: 'must-not-reach-prisma',
      pickupArea: 'North library',
      presetTagIds: ['replacement_tag'],
      priceCents: 1999,
      title: 'Revised discrete mathematics textbook',
    };

    await editOwnedContent(
      serviceAdapter,
      actor,
      'marketplace',
      'market_1',
      marketplaceEditWithExtraField,
    );

    expect(adapter.marketplaceItem.updateMany).toHaveBeenCalledWith({
      data: {
        condition: marketplaceEditWithExtraField.condition,
        contact: marketplaceEditWithExtraField.contact,
        description: marketplaceEditWithExtraField.description,
        pickupArea: marketplaceEditWithExtraField.pickupArea,
        priceCents: marketplaceEditWithExtraField.priceCents,
        status: 'DRAFT',
        title: marketplaceEditWithExtraField.title,
      },
      where: {
        id: 'market_1',
        sellerId: actor.id,
        status: { in: ['DRAFT', 'REJECTED'] },
      },
    });
  });

  it.each(['P2002', 'P2034'])(
    'restarts the entire Serializable create transaction after %s',
    async (code) => {
      const { adapter, serviceAdapter } = createAdapter([
        {
          id: 'doc_1',
          kind: 'RESOURCE_DOCUMENT',
          marketplaceItemId: null,
          ownerId: actor.id,
          resourceId: null,
          status: 'READY',
        },
      ]);
      let attempts = 0;
      adapter.$transaction.mockImplementation(
        async <T>(operation: (tx: typeof adapter) => Promise<T>) => {
          attempts += 1;
          const result = await operation(adapter);
          if (attempts === 1) throw { code };
          return result;
        },
      );

      await expect(
        createResource(serviceAdapter, actor, resourceInput),
      ).resolves.toMatchObject({ status: 'PENDING' });
      expect(adapter.$transaction).toHaveBeenCalledTimes(2);
      expect(adapter.resource.create).toHaveBeenCalledTimes(2);
      expect(adapter.tagDefinition.findUnique).toHaveBeenCalledTimes(2);
      expect(adapter.asset.updateMany).toHaveBeenCalledTimes(2);
    },
  );

  it('presents inactive historical tags to owners without using legacy resource tags', async () => {
    const { adapter, serviceAdapter } = createAdapter();
    adapter.resource.findFirst.mockResolvedValue({
      id: 'resource_1',
      status: 'DRAFT',
      tagAssignments: [
        {
          tag: {
            id: 'inactive_tag',
            isActive: false,
            isPreset: true,
            label: '旧标签',
          },
        },
      ],
      tags: ['legacy-string-must-not-win'],
      title: 'Historical resource',
    });

    await expect(
      getOwnedContent(serviceAdapter, actor, 'resource', 'resource_1'),
    ).resolves.toMatchObject({
      tags: [
        {
          id: 'inactive_tag',
          isActive: false,
          isPreset: true,
          label: '旧标签',
        },
      ],
    });
  });

  it('fails closed when production tries to attach an unscanned document', async () => {
    const { adapter, serviceAdapter } = createAdapter([
      {
        id: 'doc_1',
        kind: 'RESOURCE_DOCUMENT',
        marketplaceItemId: null,
        ownerId: actor.id,
        resourceId: null,
        scanStatus: 'PENDING',
        status: 'READY',
      },
    ]);

    await expect(
      createResource(serviceAdapter, actor, resourceInput, {
        requireCleanDocuments: true,
      }),
    ).rejects.toThrow('Document malware scan has not passed');
    expect(adapter.resource.create).not.toHaveBeenCalled();
    expect(adapter.asset.updateMany).not.toHaveBeenCalled();
  });

  it('fails before submit when an asset changes after the read', async () => {
    const { adapter, serviceAdapter } = createAdapter([
      {
        id: 'doc_1',
        kind: 'RESOURCE_DOCUMENT',
        marketplaceItemId: null,
        ownerId: actor.id,
        resourceId: null,
        status: 'READY',
      },
    ]);
    adapter.asset.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      createResource(serviceAdapter, actor, resourceInput),
    ).rejects.toBeInstanceOf(ContentConflictError);
    expect(adapter.resource.update).not.toHaveBeenCalled();
  });

  it('takes owner and campus only from the verified actor', async () => {
    const { adapter, serviceAdapter } = createAdapter();
    await createJobPost(serviceAdapter, actor, {
      company: 'Campus Cafe',
      description: 'Help serve students during the weekend lunch shift.',
      location: 'Student centre',
      payText: '$20/hour',
      title: 'Weekend assistant',
    });
    expect(adapter.jobPost.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        authorId: 'user_server',
        campusId: 'campus_server',
        status: 'DRAFT',
      }),
    });
    expect(adapter.jobPost.update).toHaveBeenCalledWith({
      data: { status: 'PENDING' },
      where: { id: 'job_1' },
    });
  });

  it('lists only published public content with stable newest-first pagination', async () => {
    const { adapter, serviceAdapter } = createAdapter();
    const result = await listPublicContent(serviceAdapter, 'resource', {
      page: 2,
      pageSize: 2,
    });
    expect(adapter.resource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 2,
        take: 2,
        where: expect.objectContaining({ status: 'PUBLISHED' }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ page: 2, pageSize: 2, total: 3 }),
    );
  });

  it('filters public resources through tag relations instead of legacy string tags', async () => {
    const { adapter, serviceAdapter } = createAdapter();
    await listPublicContent(serviceAdapter, 'resource', {
      page: 1,
      pageSize: 12,
      tag: '算法',
    });

    expect(adapter.resource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tagAssignments: {
            some: {
              tag: { label: { equals: '算法', mode: 'insensitive' } },
            },
          },
        }),
      }),
    );
  });

  it('filters public marketplace items through tag relations instead of legacy string tags', async () => {
    const { adapter, serviceAdapter } = createAdapter();
    await listPublicContent(serviceAdapter, 'marketplace', {
      page: 1,
      pageSize: 12,
      tag: '教材',
    });

    expect(adapter.marketplaceItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tagAssignments: {
            some: {
              tag: { label: { equals: '教材', mode: 'insensitive' } },
            },
          },
        }),
      }),
    );
  });

  it('shows the latest immutable decision across every content moderation action', async () => {
    const { adapter, serviceAdapter } = createAdapter();
    const items = await listOwnedContent(serviceAdapter, actor, 'resource');
    expect(adapter.moderationAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          action: true,
          createdAt: true,
          id: true,
          reason: true,
          subjectId: true,
        },
        where: expect.objectContaining({
          action: {
            in: ['APPROVE', 'REJECT', 'HIDE', 'RESTORE', 'ARCHIVE'],
          },
        }),
      }),
    );
    expect(items.find((item) => item.id === 'r3')).toMatchObject({
      decisionAction: 'APPROVE',
      decisionReason: 'Latest approval replaces the earlier rejection note.',
    });
  });
});
