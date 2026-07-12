import { describe, expect, it, vi } from 'vitest';

import {
  ContentConflictError,
  type ContentAdapter,
  createJobPost,
  createMarketplaceItem,
  createResource,
  listOwnedContent,
  listPublicContent,
} from '@/lib/domain/content-service';

const actor = {
  campusId: 'campus_server',
  id: 'user_server',
  role: 'STUDENT' as const,
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
  const adapter = {
    $transaction: vi.fn(
      async <T>(operation: (tx: typeof adapter) => Promise<T>) =>
        operation(adapter),
    ),
    asset: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        assets.filter((asset) => where.id.in.includes(asset.id)),
      ),
      updateMany: vi.fn(async () => ({ count: assets.length })),
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
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const record = { ...data, id: 'market_1' };
        created.push(record);
        return record;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'market_1',
        ...data,
      })),
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
        const record = { ...data, id: 'resource_1' };
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
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'resource_1',
        ...data,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  return {
    adapter,
    created,
    serviceAdapter: adapter as unknown as ContentAdapter,
  };
}

const resourceInput = {
  assetIds: ['doc_1'],
  courseCode: 'CS 101',
  summary: 'Complete lecture notes with worked examples and exercises.',
  tags: ['algorithms'],
  title: 'Algorithms revision notes',
};

describe('content service', () => {
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
        description: 'A carefully used discrete mathematics textbook.',
        pickupArea: 'North library',
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
    const result = await createResource(serviceAdapter, actor, resourceInput);

    expect(adapter.$transaction).toHaveBeenCalledOnce();
    expect(adapter.resource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        authorId: actor.id,
        campusId: actor.campusId,
        status: 'DRAFT',
      }),
    });
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
