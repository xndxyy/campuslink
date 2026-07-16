import { describe, expect, it, vi } from 'vitest';

import {
  archiveOwnedContent,
  type ContentAdapter,
  ContentConflictError,
  ContentNotFoundError,
  type ContentPublishingPolicy,
  deleteOwnedContent,
  editOwnedContent,
  submitOwnedDraft,
} from '@/lib/domain/content-service';
import type { PreparedAssessmentBatch } from '@/lib/moderation/content-assessment';

const actor = {
  campusId: 'campus_1',
  emailVerifiedAt: new Date('2026-07-14T00:00:00Z'),
  id: 'owner_1',
  role: 'STUDENT' as const,
  status: 'ACTIVE' as const,
};

function adapter(updateCount = 1) {
  const updateMany = vi.fn(async () => ({ count: updateCount }));
  const delegate = {
    create: vi.fn(),
    deleteMany: vi.fn(async () => ({ count: 1 })),
    findFirst: vi.fn(async () => ({
      assets: [
        {
          id: 'asset_1',
          status: 'READY',
          storageKey: 'resource/asset_1.pdf',
        },
      ],
      authorId: actor.id,
      campusId: actor.campusId,
      id: 'resource_1',
      sellerId: actor.id,
      status: 'DRAFT',
      summary: 'Complete notes with worked examples.',
      tagAssignments: [{ tag: { isPreset: false, label: '算法' } }],
      title: 'Algorithms revision notes',
    })),
    update: vi.fn(),
    updateMany,
  };
  const value = {
    $transaction: vi.fn(
      async (operation: (tx: ContentAdapter) => Promise<unknown>) =>
        operation(value as unknown as ContentAdapter),
    ),
    asset: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: { create: vi.fn(async () => ({})) },
    contentAssessment: {
      create: vi.fn(async () => ({ id: 'assessment_1' })),
    },
    campusWorkPost: { ...delegate, updateMany },
    campusWorkTag: {
      createMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    marketplaceItem: { ...delegate, updateMany },
    favourite: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    report: {
      findFirst: vi.fn(async () => null),
    },
    resource: { ...delegate, updateMany },
    storageDeletionJob: {
      upsert: vi.fn(async () => ({ id: 'deletion_1' })),
    },
    tagDefinition: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(),
    },
  };
  return {
    db: value as unknown as ContentAdapter,
    updateMany,
  };
}

function reviewPolicy(): ContentPublishingPolicy {
  const outcome = { kind: 'review', reasonZh: '需要人工确认内容' } as const;
  const prepared = {
    assessments: [
      {
        auditSkipped: false,
        data: {
          campusId: actor.campusId,
          decision: 'REVIEW',
          providerStatus: 'COMPLETED',
          targetId: 'resource_1',
          targetType: 'RESOURCE',
        },
        outcome,
        targetId: 'resource_1',
        targetType: 'RESOURCE',
      },
    ],
    campusId: actor.campusId,
    outcome,
  } as unknown as PreparedAssessmentBatch;
  return { prepare: vi.fn(async () => prepared) };
}

describe('owned content workflows', () => {
  it('reassesses current content and custom tags when resubmitting a draft', async () => {
    const { db, updateMany } = adapter();
    const publishing = reviewPolicy();

    await expect(
      submitOwnedDraft(
        db,
        actor,
        'resource',
        'resource_1',
        undefined,
        publishing,
      ),
    ).resolves.toStrictEqual({ id: 'resource_1', status: 'PENDING' });

    expect(publishing.prepare).toHaveBeenCalledWith({
      campusId: actor.campusId,
      requests: [
        {
          content: {
            summary: 'Complete notes with worked examples.',
            title: 'Algorithms revision notes',
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
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PENDING' } }),
    );
    expect(db.contentAssessment.create).toHaveBeenCalledTimes(1);
  });

  it('edits only an owned draft or rejected record and returns rejected to draft', async () => {
    const { db, updateMany } = adapter();
    await editOwnedContent(db, actor, 'campus-work', 'work_1', {
      contact: 'campus inbox',
      customTags: [],
      description: 'A revised and complete weekend role description.',
      location: 'Student centre',
      payText: '$20/hour',
      presetTagIds: [],
      title: 'Weekend assistant',
    });
    expect(updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'DRAFT',
        title: 'Weekend assistant',
      }),
      where: {
        authorId: actor.id,
        id: 'work_1',
        status: { in: ['DRAFT', 'REJECTED'] },
      },
    });
  });

  it('reports a conflict when a concurrent state change makes an edit update zero rows', async () => {
    const { db } = adapter(0);
    await expect(
      editOwnedContent(db, actor, 'campus-work', 'work_1', {
        contact: 'campus inbox',
        customTags: [],
        description: 'A revised and complete weekend role description.',
        location: 'Student centre',
        payText: '$20/hour',
        presetTagIds: [],
        title: 'Weekend assistant',
      }),
    ).rejects.toBeInstanceOf(ContentConflictError);
  });

  it('archives with owner and allowed-current-status in one conditional update', async () => {
    const { db, updateMany } = adapter();
    await archiveOwnedContent(db, actor, 'resource', 'resource_1');
    expect(updateMany).toHaveBeenCalledWith({
      data: { status: 'ARCHIVED' },
      where: {
        authorId: actor.id,
        id: 'resource_1',
        status: { in: ['PENDING', 'PUBLISHED'] },
      },
    });
  });

  it('resubmits a text-only resource without requiring an attachment', async () => {
    const { db, updateMany } = adapter();
    await submitOwnedDraft(db, actor, 'resource', 'resource_1');
    expect(updateMany).toHaveBeenCalledWith({
      data: { status: 'PENDING' },
      where: {
        authorId: actor.id,
        id: 'resource_1',
        status: 'DRAFT',
      },
    });
  });

  it('rejects any attached unclean document in production resubmission', async () => {
    const { db, updateMany } = adapter();
    await submitOwnedDraft(db, actor, 'resource', 'resource_1', {
      requireCleanDocuments: true,
    });
    expect(updateMany).toHaveBeenCalledWith({
      data: { status: 'PENDING' },
      where: {
        assets: {
          none: {
            kind: 'RESOURCE_DOCUMENT',
            scanStatus: { not: 'CLEAN' },
          },
        },
        authorId: actor.id,
        id: 'resource_1',
        status: 'DRAFT',
      },
    });
  });

  it.each([
    ['resource', 'RESOURCE', 'authorId'],
    ['marketplace', 'MARKETPLACE_ITEM', 'sellerId'],
    ['campus-work', 'JOB_POST', 'authorId'],
  ] as const)(
    'physically deletes owned %s content and queues attached storage',
    async (kind, targetType, ownerField) => {
      const { db } = adapter();

      await expect(
        deleteOwnedContent(db, actor, kind, 'resource_1'),
      ).resolves.toStrictEqual({
        archived: false,
        deleted: true,
        id: 'resource_1',
      });

      expect(db.report.findFirst).toHaveBeenCalledWith({
        select: { id: true },
        where: {
          campusId: actor.campusId,
          status: { in: ['OPEN', 'TRIAGED'] },
          targetId: 'resource_1',
          targetType,
        },
      });
      expect(db.storageDeletionJob.upsert).toHaveBeenCalledWith({
        create: { storageKey: 'resource/asset_1.pdf' },
        update: {},
        where: { storageKey: 'resource/asset_1.pdf' },
      });
      expect(db.asset.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['asset_1'] } },
      });
      expect(db.favourite.deleteMany).toHaveBeenCalledWith({
        where: { targetId: 'resource_1', targetType },
      });
      expect(db[kind === 'resource' ? 'resource' : kind === 'marketplace' ? 'marketplaceItem' : 'campusWorkPost'].deleteMany).toHaveBeenCalledWith({
        where: {
          campusId: actor.campusId,
          id: 'resource_1',
          [ownerField]: actor.id,
        },
      });
    },
  );

  it('archives an owner deletion request while an active report preserves evidence', async () => {
    const { db } = adapter();
    vi.mocked(db.report.findFirst).mockResolvedValue({ id: 'report_1' });

    await expect(
      deleteOwnedContent(db, actor, 'resource', 'resource_1'),
    ).resolves.toStrictEqual({
      archived: true,
      deleted: false,
      id: 'resource_1',
    });

    expect(db.resource.updateMany).toHaveBeenCalledWith({
      data: {
        ownerDeletionRequestedAt: expect.any(Date),
        status: 'ARCHIVED',
      },
      where: {
        authorId: actor.id,
        campusId: actor.campusId,
        id: 'resource_1',
      },
    });
    expect(db.storageDeletionJob.upsert).not.toHaveBeenCalled();
    expect(db.resource.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects cross-user deletion without queuing a storage deletion', async () => {
    const { db } = adapter();
    vi.mocked(db.resource.findFirst!).mockResolvedValue(null);

    await expect(
      deleteOwnedContent(db, actor, 'resource', 'resource_1'),
    ).rejects.toBeInstanceOf(ContentNotFoundError);
    expect(db.storageDeletionJob.upsert).not.toHaveBeenCalled();
  });

  it('queues non-ready attached storage before deleting its asset row', async () => {
    const { db } = adapter();
    vi.mocked(db.resource.findFirst!).mockResolvedValue({
      assets: [
        {
          id: 'pending_asset_1',
          status: 'PENDING',
          storageKey: 'resource/pending_asset_1.pdf',
        },
      ],
      authorId: actor.id,
      campusId: actor.campusId,
      id: 'resource_1',
    });

    await deleteOwnedContent(db, actor, 'resource', 'resource_1');

    expect(db.storageDeletionJob.upsert).toHaveBeenCalledWith({
      create: { storageKey: 'resource/pending_asset_1.pdf' },
      update: {},
      where: { storageKey: 'resource/pending_asset_1.pdf' },
    });
  });
});
