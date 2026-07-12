import { describe, expect, it, vi } from 'vitest';

import {
  archiveOwnedContent,
  type ContentAdapter,
  ContentConflictError,
  editOwnedContent,
  submitOwnedDraft,
} from '@/lib/domain/content-service';

const actor = { campusId: 'campus_1', id: 'owner_1', role: 'STUDENT' as const };

function adapter(updateCount = 1) {
  const updateMany = vi.fn(async () => ({ count: updateCount }));
  const delegate = {
    create: vi.fn(),
    update: vi.fn(),
    updateMany,
  };
  return {
    db: {
      $transaction: vi.fn(),
      asset: { findMany: vi.fn(), updateMany: vi.fn() },
      jobPost: { ...delegate, updateMany },
      marketplaceItem: { ...delegate, updateMany },
      resource: { ...delegate, updateMany },
    } as unknown as ContentAdapter,
    updateMany,
  };
}

describe('owned content workflows', () => {
  it('edits only an owned draft or rejected record and returns rejected to draft', async () => {
    const { db, updateMany } = adapter();
    await editOwnedContent(db, actor, 'job', 'job_1', {
      company: 'Campus Cafe',
      description: 'A revised and complete weekend role description.',
      location: 'Student centre',
      payText: '$20/hour',
      title: 'Weekend assistant',
    });
    expect(updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'DRAFT', title: 'Weekend assistant' }),
      where: { authorId: actor.id, id: 'job_1', status: { in: ['DRAFT', 'REJECTED'] } },
    });
  });

  it('reports a conflict when a concurrent state change makes an edit update zero rows', async () => {
    const { db } = adapter(0);
    await expect(
      editOwnedContent(db, actor, 'job', 'job_1', {
        company: 'Campus Cafe', description: 'A revised and complete weekend role description.',
        location: 'Student centre', payText: '$20/hour', title: 'Weekend assistant',
      }),
    ).rejects.toBeInstanceOf(ContentConflictError);
  });

  it('archives with owner and allowed-current-status in one conditional update', async () => {
    const { db, updateMany } = adapter();
    await archiveOwnedContent(db, actor, 'resource', 'resource_1');
    expect(updateMany).toHaveBeenCalledWith({
      data: { status: 'ARCHIVED' },
      where: { authorId: actor.id, id: 'resource_1', status: { in: ['PENDING', 'PUBLISHED'] } },
    });
  });

  it('resubmits a resource only when a ready owned document remains attached', async () => {
    const { db, updateMany } = adapter();
    await submitOwnedDraft(db, actor, 'resource', 'resource_1');
    expect(updateMany).toHaveBeenCalledWith({
      data: { status: 'PENDING' },
      where: {
        assets: { some: { kind: 'RESOURCE_DOCUMENT', ownerId: actor.id, status: 'READY' } },
        authorId: actor.id,
        id: 'resource_1',
        status: 'DRAFT',
      },
    });
  });
});
