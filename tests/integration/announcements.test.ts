import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDbClient } from '@/lib/db';
import {
  AnnouncementConflictError,
  AnnouncementNotFoundError,
  createAnnouncement,
  deleteAnnouncement,
  type AnnouncementAdapter,
} from '@/lib/domain/announcements';
import { StorageObjectNotFoundError } from '@/lib/storage/client';
import {
  processStorageDeletionJob,
  type StorageDeletionAdapter,
} from '@/lib/storage/deletion-jobs';

const describeWithDatabase = describe.skipIf(!process.env.DATABASE_URL);

describeWithDatabase(
  'announcement persistence and reliable cover deletion',
  () => {
    let db: ReturnType<typeof createDbClient>;
    let campusId = '';
    let otherCampusId = '';
    let adminId = '';
    let otherAdminId = '';
    const campusIds: string[] = [];
    const userIds: string[] = [];
    const assetIds: string[] = [];
    const announcementIds: string[] = [];
    const storageKeys: string[] = [];

    beforeAll(async () => {
      db = createDbClient();
      const suffix = randomUUID();
      const campus = await db.campus.create({
        data: { name: 'Announcement Campus', slug: `announcement-${suffix}` },
      });
      campusIds.push(campus.id);
      campusId = campus.id;
      const otherCampus = await db.campus.create({
        data: { name: 'Other Campus', slug: `announcement-other-${suffix}` },
      });
      campusIds.push(otherCampus.id);
      otherCampusId = otherCampus.id;
      const admin = await db.user.create({
        data: {
          campusId,
          email: `admin-${suffix}@example.com`,
          emailVerifiedAt: new Date(),
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });
      userIds.push(admin.id);
      adminId = admin.id;
      const otherAdmin = await db.user.create({
        data: {
          campusId: otherCampusId,
          email: `other-admin-${suffix}@example.com`,
          emailVerifiedAt: new Date(),
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });
      userIds.push(otherAdmin.id);
      otherAdminId = otherAdmin.id;
    });

    afterAll(async () => {
      if (!db) return;
      const errors: unknown[] = [];
      const attempt = async (operation: () => Promise<unknown>) => {
        try {
          await operation();
        } catch (error) {
          errors.push(error);
        }
      };
      if (storageKeys.length > 0) {
        await attempt(() =>
          db.storageDeletionJob.deleteMany({
            where: { storageKey: { in: storageKeys } },
          }),
        );
      }
      if (campusIds.length > 0) {
        await attempt(() =>
          db.auditLog.deleteMany({ where: { campusId: { in: campusIds } } }),
        );
      }
      if (assetIds.length > 0) {
        await attempt(() =>
          db.asset.deleteMany({ where: { id: { in: assetIds } } }),
        );
      }
      if (announcementIds.length > 0) {
        await attempt(() =>
          db.announcement.deleteMany({
            where: { id: { in: announcementIds } },
          }),
        );
      }
      if (userIds.length > 0) {
        await attempt(() =>
          db.user.deleteMany({ where: { id: { in: userIds } } }),
        );
      }
      if (campusIds.length > 0) {
        await attempt(() =>
          db.campus.deleteMany({ where: { id: { in: campusIds } } }),
        );
      }
      await attempt(() => db.$disconnect());
      if (errors.length > 0) {
        throw new AggregateError(errors, 'Announcement fixture cleanup failed');
      }
    });

    it('creates campus-scoped announcements, keeps one pin, validates covers, and deletes with an auditable outbox', async () => {
      const actor = { campusId, id: adminId, role: 'ADMIN' as const };
      const first = await createAnnouncement(
        db as unknown as AnnouncementAdapter,
        actor,
        {
          body: '第一条置顶公告正文。',
          coverAssetId: null,
          isPinned: true,
          title: '第一条公告',
        },
      );
      announcementIds.push(first.id);
      const cover = await db.asset.create({
        data: {
          contentType: 'image/png',
          kind: 'ANNOUNCEMENT_IMAGE',
          ownerId: adminId,
          sizeBytes: 10,
          status: 'READY',
          storageKey: `announcements/${adminId}/${randomUUID()}`,
        },
      });
      assetIds.push(cover.id);
      storageKeys.push(cover.storageKey);
      const second = await createAnnouncement(
        db as unknown as AnnouncementAdapter,
        actor,
        {
          body: '第二条置顶公告正文。',
          coverAssetId: cover.id,
          isPinned: true,
          title: '第二条公告',
        },
      );
      announcementIds.push(second.id);
      expect(
        await db.announcement.count({ where: { campusId, isPinned: true } }),
      ).toBe(1);
      expect(
        await db.announcement.findUnique({ where: { id: first.id } }),
      ).toMatchObject({ isPinned: false });

      const otherAnnouncement = await createAnnouncement(
        db as unknown as AnnouncementAdapter,
        { campusId: otherCampusId, id: otherAdminId, role: 'ADMIN' },
        {
          body: '其他校园的公告不可由当前校园管理。',
          coverAssetId: null,
          isPinned: false,
          title: '其他校园公告',
        },
      );
      announcementIds.push(otherAnnouncement.id);
      await expect(
        deleteAnnouncement(
          db as unknown as AnnouncementAdapter,
          actor,
          otherAnnouncement.id,
          {
            processDeletion: vi.fn(),
          },
        ),
      ).rejects.toBeInstanceOf(AnnouncementNotFoundError);

      const foreignCover = await db.asset.create({
        data: {
          contentType: 'image/png',
          kind: 'ANNOUNCEMENT_IMAGE',
          ownerId: otherAdminId,
          sizeBytes: 10,
          status: 'READY',
          storageKey: `announcements/${otherAdminId}/${randomUUID()}`,
        },
      });
      assetIds.push(foreignCover.id);
      storageKeys.push(foreignCover.storageKey);
      await expect(
        createAnnouncement(db as unknown as AnnouncementAdapter, actor, {
          body: '不可使用其他校园管理员的封面。',
          coverAssetId: foreignCover.id,
          isPinned: false,
          title: '非法封面公告',
        }),
      ).rejects.toBeInstanceOf(AnnouncementConflictError);

      const wrongKind = await db.asset.create({
        data: {
          contentType: 'image/png',
          kind: 'RESOURCE_IMAGE',
          ownerId: adminId,
          sizeBytes: 10,
          status: 'READY',
          storageKey: `resources/${adminId}/${randomUUID()}`,
        },
      });
      assetIds.push(wrongKind.id);
      storageKeys.push(wrongKind.storageKey);
      const pendingCover = await db.asset.create({
        data: {
          contentType: 'image/png',
          kind: 'ANNOUNCEMENT_IMAGE',
          ownerId: adminId,
          sizeBytes: 10,
          status: 'PENDING',
          storageKey: `announcements/${adminId}/${randomUUID()}`,
        },
      });
      assetIds.push(pendingCover.id);
      storageKeys.push(pendingCover.storageKey);
      for (const ineligibleCover of [wrongKind, pendingCover]) {
        await expect(
          createAnnouncement(db as unknown as AnnouncementAdapter, actor, {
            body: '封面必须是已就绪的公告图片。',
            coverAssetId: ineligibleCover.id,
            isPinned: false,
            title: '封面状态检查',
          }),
        ).rejects.toBeInstanceOf(AnnouncementConflictError);
      }

      const storage = { deleteObject: vi.fn(async () => undefined) };
      const deleted = await deleteAnnouncement(
        db as unknown as AnnouncementAdapter,
        actor,
        second.id,
        {
          processDeletion: (jobId) =>
            processStorageDeletionJob(
              db as unknown as StorageDeletionAdapter,
              storage,
              jobId,
            ),
        },
      );
      expect(deleted.storageDeletionQueued).toBe(false);
      expect(
        await db.announcement.findUnique({ where: { id: second.id } }),
      ).toBeNull();
      expect(await db.asset.findUnique({ where: { id: cover.id } })).toBeNull();
      expect(storage.deleteObject).toHaveBeenCalledWith(cover.storageKey);
      expect(
        await db.storageDeletionJob.findUnique({
          where: { storageKey: cover.storageKey },
        }),
      ).toBeNull();
      const audit = await db.auditLog.findFirst({
        where: { action: 'ANNOUNCEMENT_DELETED', subjectId: second.id },
      });
      expect(audit?.details).toEqual({ hadCover: true });
      expect(JSON.stringify(audit)).not.toContain(cover.storageKey);
    });

    it('keeps the DB deletion committed on storage failure and treats a missing object as success on retry', async () => {
      const actor = { campusId, id: adminId, role: 'ADMIN' as const };
      const cover = await db.asset.create({
        data: {
          contentType: 'image/png',
          kind: 'ANNOUNCEMENT_IMAGE',
          ownerId: adminId,
          sizeBytes: 10,
          status: 'READY',
          storageKey: `announcements/${adminId}/${randomUUID()}`,
        },
      });
      assetIds.push(cover.id);
      storageKeys.push(cover.storageKey);
      const announcement = await createAnnouncement(
        db as unknown as AnnouncementAdapter,
        actor,
        {
          body: '验证删除重试队列。',
          coverAssetId: cover.id,
          isPinned: false,
          title: '删除重试公告',
        },
      );
      announcementIds.push(announcement.id);
      const failureStorage = {
        deleteObject: vi.fn(async () => {
          throw new Error('private endpoint failure');
        }),
      };
      const result = await deleteAnnouncement(
        db as unknown as AnnouncementAdapter,
        actor,
        announcement.id,
        {
          processDeletion: (jobId) =>
            processStorageDeletionJob(
              db as unknown as StorageDeletionAdapter,
              failureStorage,
              jobId,
            ),
        },
      );
      expect(result.storageDeletionQueued).toBe(true);
      expect(
        await db.announcement.findUnique({ where: { id: announcement.id } }),
      ).toBeNull();
      const job = await db.storageDeletionJob.findUnique({
        where: { storageKey: cover.storageKey },
      });
      expect(job?.attempts).toBe(1);

      await expect(
        processStorageDeletionJob(
          db as unknown as StorageDeletionAdapter,
          {
            deleteObject: vi.fn(async () => {
              throw new StorageObjectNotFoundError();
            }),
          },
          job!.id,
          () => new Date(job!.nextAttempt.getTime() + 1),
        ),
      ).resolves.toEqual({ status: 'deleted' });
      expect(
        await db.storageDeletionJob.findUnique({ where: { id: job!.id } }),
      ).toBeNull();
    });
  },
);
