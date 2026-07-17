import { z } from 'zod';

import { createS3UploadStorage } from '@/lib/storage/client';
import { isTransactionConflict } from '@/lib/domain/transaction-errors';
import {
  processStorageDeletionJob,
  type StorageDeletionAdapter,
  type StorageDeletionResult,
} from '@/lib/storage/deletion-jobs';
import { plainText } from '@/lib/validation/content';
import type { StaffActor } from './moderation';

export const announcementInput = z
  .object({
    body: plainText(1, 10_000, 'Announcement body'),
    coverAssetId: z.string().trim().min(1).max(191).nullable(),
    isPinned: z.boolean(),
    title: plainText(3, 200, 'Announcement title'),
  })
  .strict();

type AnnouncementInput = z.infer<typeof announcementInput>;

interface CountResult {
  count: number;
}

interface AnnouncementRecord extends Record<string, unknown> {
  id: string;
}

export interface AnnouncementAdapter {
  $transaction<T>(
    operation: (tx: AnnouncementAdapter) => Promise<T>,
    options?: { isolationLevel: 'Serializable' },
  ): Promise<T>;
  announcement: {
    create(args: Record<string, unknown>): Promise<AnnouncementRecord>;
    deleteMany(args: Record<string, unknown>): Promise<CountResult>;
    findFirst(
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown> | null>;
    updateMany(args: Record<string, unknown>): Promise<CountResult>;
  };
  asset: {
    deleteMany(args: Record<string, unknown>): Promise<CountResult>;
    findFirst(
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown> | null>;
    updateMany(args: Record<string, unknown>): Promise<CountResult>;
  };
  auditLog: {
    create(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  storageDeletionJob: StorageDeletionAdapter['storageDeletionJob'] & {
    upsert(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
}

export class AnnouncementForbiddenError extends Error {
  constructor() {
    super('Administrator access is required');
    this.name = 'AnnouncementForbiddenError';
  }
}

export class AnnouncementValidationError extends Error {
  constructor(message = 'Invalid announcement input') {
    super(message);
    this.name = 'AnnouncementValidationError';
  }
}

export class AnnouncementConflictError extends Error {
  constructor(message = 'Announcement state conflict') {
    super(message);
    this.name = 'AnnouncementConflictError';
  }
}

export class AnnouncementNotFoundError extends Error {
  constructor() {
    super('Announcement was not found');
    this.name = 'AnnouncementNotFoundError';
  }
}

function requireAdmin(actor: StaffActor) {
  if (actor.role !== 'ADMIN') throw new AnnouncementForbiddenError();
}

function isConstraintConflict(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'P2002' || code === 'P2025';
}

async function serializableTransaction<T>(
  adapter: AnnouncementAdapter,
  operation: (tx: AnnouncementAdapter) => Promise<T>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await adapter.$transaction(operation, {
        isolationLevel: 'Serializable',
      });
    } catch (error) {
      if (error instanceof AnnouncementConflictError) throw error;
      if (isTransactionConflict(error)) {
        if (attempt < 2) continue;
        throw new AnnouncementConflictError();
      }
      if (isConstraintConflict(error)) throw new AnnouncementConflictError();
      throw error;
    }
  }
  throw new AnnouncementConflictError();
}

function parseInput(input: AnnouncementInput) {
  const parsed = announcementInput.safeParse(input);
  if (!parsed.success) throw new AnnouncementValidationError();
  return parsed.data;
}

const eligibleCoverWhere = (actorId: string, coverAssetId: string) => ({
  announcementId: null,
  id: coverAssetId,
  kind: 'ANNOUNCEMENT_IMAGE',
  ownerId: actorId,
  status: 'READY',
});

export async function createAnnouncement(
  adapter: AnnouncementAdapter,
  actor: StaffActor,
  input: AnnouncementInput,
) {
  requireAdmin(actor);
  const data = parseInput(input);
  return serializableTransaction(adapter, async (tx) => {
    if (data.coverAssetId) {
      const cover = await tx.asset.findFirst({
        select: { id: true },
        where: eligibleCoverWhere(actor.id, data.coverAssetId),
      });
      if (!cover) throw new AnnouncementConflictError();
    }
    if (data.isPinned) {
      await tx.announcement.updateMany({
        data: { isPinned: false },
        where: { campusId: actor.campusId, isPinned: true },
      });
    }
    const announcement = await tx.announcement.create({
      data: {
        authorId: actor.id,
        body: data.body,
        campusId: actor.campusId,
        isPinned: data.isPinned,
        title: data.title,
      },
      select: {
        body: true,
        id: true,
        isPinned: true,
        publishedAt: true,
        title: true,
      },
    });
    if (data.coverAssetId) {
      const attached = await tx.asset.updateMany({
        data: { announcementId: announcement.id },
        where: eligibleCoverWhere(actor.id, data.coverAssetId),
      });
      if (attached.count !== 1) throw new AnnouncementConflictError();
    }
    return { ...announcement, coverAssetId: data.coverAssetId };
  });
}

function announcementId(value: string) {
  const parsed = z.string().trim().min(1).max(191).safeParse(value);
  if (!parsed.success) throw new AnnouncementValidationError();
  return parsed.data;
}

export async function deleteAnnouncement(
  adapter: AnnouncementAdapter,
  actor: StaffActor,
  idValue: string,
  options: {
    processDeletion?: (jobId: string) => Promise<StorageDeletionResult>;
  } = {},
) {
  requireAdmin(actor);
  const id = announcementId(idValue);
  const deleted = await serializableTransaction(adapter, async (tx) => {
    const announcement = await tx.announcement.findFirst({
      select: {
        cover: { select: { id: true, storageKey: true } },
        id: true,
      },
      where: { campusId: actor.campusId, id },
    });
    if (!announcement) throw new AnnouncementNotFoundError();
    const cover = announcement.cover as
      { id: string; storageKey: string } | null | undefined;
    if (cover) {
      const removed = await tx.asset.deleteMany({
        where: { announcementId: id, id: cover.id },
      });
      if (removed.count !== 1) throw new AnnouncementConflictError();
    }
    const removed = await tx.announcement.deleteMany({
      where: { campusId: actor.campusId, id },
    });
    if (removed.count !== 1) throw new AnnouncementNotFoundError();
    const job = cover
      ? await tx.storageDeletionJob.upsert({
          create: { storageKey: cover.storageKey },
          update: {},
          where: { storageKey: cover.storageKey },
        })
      : null;
    await tx.auditLog.create({
      data: {
        action: 'ANNOUNCEMENT_DELETED',
        actorId: actor.id,
        campusId: actor.campusId,
        details: { hadCover: Boolean(cover) },
        subjectId: id,
        subjectType: 'ANNOUNCEMENT',
      },
    });
    return { id, jobId: job ? String(job.id) : null };
  });

  if (!deleted.jobId) return { id, storageDeletionQueued: false };
  try {
    const processDeletion =
      options.processDeletion ??
      ((jobId: string) =>
        processStorageDeletionJob(
          adapter as unknown as StorageDeletionAdapter,
          createS3UploadStorage(),
          jobId,
        ));
    const processed = await processDeletion(deleted.jobId);
    return {
      id,
      storageDeletionQueued:
        processed.status === 'retry' || processed.status === 'deferred',
    };
  } catch {
    return { id, storageDeletionQueued: true };
  }
}
