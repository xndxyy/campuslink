import { describe, expect, it, vi } from 'vitest';

import {
  archiveOwnedContent,
  type ContentAdapter,
  ContentConflictError,
  type ContentPublishingPolicy,
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
    findFirst: vi.fn(async () => ({
      id: 'resource_1',
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
    asset: { findMany: vi.fn(), updateMany: vi.fn() },
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
    resource: { ...delegate, updateMany },
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
});
