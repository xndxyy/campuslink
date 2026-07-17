import { describe, expect, it, vi } from 'vitest';

import {
  AnnouncementConflictError,
  AnnouncementForbiddenError,
  AnnouncementNotFoundError,
  AnnouncementValidationError,
  announcementInput,
  createAnnouncement,
  deleteAnnouncement,
  type AnnouncementAdapter,
} from '@/lib/domain/announcements';
import { parseAuditQuery } from '@/lib/domain/audit';

const admin = { campusId: 'campus_1', id: 'admin_1', role: 'ADMIN' as const };
const validInput = {
  body: '暑期交易请优先选择公共区域。',
  coverAssetId: 'asset_1',
  isPinned: true,
  title: '暑期交易安全提醒',
};
const unsafeText = [
  '<img src=x onerror=alert(1)>',
  '<!--comment-->',
  '<!DOCTYPE html>',
  '<script',
  '< script',
  '<b>',
  'javascript:alert(1)',
];

function adapter() {
  const value = {
    $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation(value),
    ),
    announcement: {
      create: vi.fn(async ({ data }) => ({ id: 'announcement_1', ...data })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => ({
        cover: { id: 'asset_1', storageKey: 'announcements/admin_1/asset_1' },
        id: 'announcement_1',
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    asset: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => ({ id: 'asset_1' })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    auditLog: {
      create: vi.fn(async ({ data }) => ({ id: 'audit_1', ...data })),
    },
    storageDeletionJob: {
      upsert: vi.fn(async ({ create }) => ({ id: 'job_1', ...create })),
    },
  };
  return value as unknown as AnnouncementAdapter;
}

describe('announcement input', () => {
  it.each(unsafeText)('rejects unsafe title and body text: %s', (value) => {
    expect(() =>
      announcementInput.parse({ ...validInput, title: value }),
    ).toThrow();
    expect(() =>
      announcementInput.parse({ ...validInput, body: value }),
    ).toThrow();
  });

  it('allows ordinary comparison text', () => {
    expect(
      announcementInput.parse({
        ...validInput,
        body: 'When x < y, use the smaller value.',
        title: 'x < y',
      }),
    ).toMatchObject({
      body: 'When x < y, use the smaller value.',
      title: 'x < y',
    });
    expect(
      announcementInput.parse({
        ...validInput,
        body: 'x < y and z > 0',
        title: 'x < y and z > 0',
      }),
    ).toMatchObject({
      body: 'x < y and z > 0',
      title: 'x < y and z > 0',
    });
  });

  it('allows administrators to filter audit history by announcement entity', () => {
    expect(
      parseAuditQuery(new URLSearchParams('entityType=ANNOUNCEMENT')),
    ).toMatchObject({ subjectType: 'ANNOUNCEMENT' });
  });

  it('trims valid text and rejects unknown fields', () => {
    expect(
      announcementInput.parse({
        ...validInput,
        body: '  正文  ',
        title: '  校园公告  ',
      }),
    ).toEqual({ ...validInput, body: '正文', title: '校园公告' });
    expect(() =>
      announcementInput.parse({ ...validInput, authorId: 'attacker' }),
    ).toThrow();
  });

  it.each([
    { field: 'title', value: 'ab' },
    { field: 'title', value: 'x'.repeat(201) },
    { field: 'body', value: ' ' },
    { field: 'body', value: 'x'.repeat(10_001) },
    { field: 'coverAssetId', value: '' },
    { field: 'coverAssetId', value: 'x'.repeat(192) },
  ])('enforces the $field boundary', ({ field, value }) => {
    expect(() =>
      announcementInput.parse({ ...validInput, [field]: value }),
    ).toThrow();
  });
});

describe('announcement creation', () => {
  it.each(['STUDENT', 'MODERATOR'] as const)(
    'rejects %s before opening a transaction',
    async (role) => {
      const db = adapter();
      await expect(
        createAnnouncement(db, { ...admin, role }, validInput),
      ).rejects.toBeInstanceOf(AnnouncementForbiddenError);
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );

  it('creates a campus-scoped pinned announcement and attaches one eligible cover atomically', async () => {
    const db = adapter();
    const result = await createAnnouncement(db, admin, validInput);

    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(db.asset.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        announcementId: null,
        id: 'asset_1',
        kind: 'ANNOUNCEMENT_IMAGE',
        ownerId: admin.id,
        status: 'READY',
      },
    });
    expect(db.announcement.updateMany).toHaveBeenCalledWith({
      data: { isPinned: false },
      where: { campusId: admin.campusId, isPinned: true },
    });
    expect(db.announcement.create).toHaveBeenCalledWith({
      data: {
        authorId: admin.id,
        body: validInput.body,
        campusId: admin.campusId,
        isPinned: true,
        title: validInput.title,
      },
      select: expect.objectContaining({ id: true }),
    });
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      data: { announcementId: 'announcement_1' },
      where: {
        announcementId: null,
        id: 'asset_1',
        kind: 'ANNOUNCEMENT_IMAGE',
        ownerId: admin.id,
        status: 'READY',
      },
    });
    expect(result).toMatchObject({
      coverAssetId: 'asset_1',
      id: 'announcement_1',
    });
  });

  it('rejects an ineligible cover without creating or exposing why it failed', async () => {
    const db = adapter();
    vi.mocked(db.asset.findFirst).mockResolvedValue(null);
    await expect(
      createAnnouncement(db, admin, validInput),
    ).rejects.toBeInstanceOf(AnnouncementConflictError);
    expect(db.announcement.create).not.toHaveBeenCalled();
  });

  it('maps a concurrent cover attachment to a safe conflict', async () => {
    const db = adapter();
    vi.mocked(db.asset.updateMany).mockResolvedValue({ count: 0 });
    await expect(
      createAnnouncement(db, admin, validInput),
    ).rejects.toBeInstanceOf(AnnouncementConflictError);
  });

  it('retries recognized serialization failures and caps attempts at three', async () => {
    const db = adapter();
    vi.mocked(db.$transaction).mockRejectedValueOnce({
      cause: { kind: 'TransactionWriteConflict' },
      name: 'DriverAdapterError',
    });
    await expect(
      createAnnouncement(db, admin, validInput),
    ).resolves.toMatchObject({
      id: 'announcement_1',
    });
    expect(db.$transaction).toHaveBeenCalledTimes(2);

    const exhausted = adapter();
    vi.mocked(exhausted.$transaction).mockRejectedValue({
      code: 'P2010',
      meta: {
        driverAdapterError: { cause: { originalCode: '40001' } },
      },
    });
    await expect(
      createAnnouncement(exhausted, admin, validInput),
    ).rejects.toBeInstanceOf(AnnouncementConflictError);
    expect(exhausted.$transaction).toHaveBeenCalledTimes(3);
  });

  it('maps invalid domain input to a typed validation error', async () => {
    await expect(
      createAnnouncement(adapter(), admin, { ...validInput, title: 'x' }),
    ).rejects.toBeInstanceOf(AnnouncementValidationError);
  });
});

describe('permanent announcement deletion', () => {
  it.each(['STUDENT', 'MODERATOR'] as const)(
    'rejects %s before looking up the announcement',
    async (role) => {
      const db = adapter();
      await expect(
        deleteAnnouncement(db, { ...admin, role }, 'announcement_1', {
          processDeletion: vi.fn(),
        }),
      ).rejects.toBeInstanceOf(AnnouncementForbiddenError);
      expect(db.announcement.findFirst).not.toHaveBeenCalled();
    },
  );

  it('deletes DB records, enqueues the cover, and writes only a minimal audit before processing storage', async () => {
    const db = adapter();
    const processDeletion = vi.fn(async () => ({ status: 'deleted' as const }));
    const result = await deleteAnnouncement(db, admin, 'announcement_1', {
      processDeletion,
    });

    expect(db.announcement.findFirst).toHaveBeenCalledWith({
      select: { cover: { select: { id: true, storageKey: true } }, id: true },
      where: { campusId: admin.campusId, id: 'announcement_1' },
    });
    expect(db.asset.deleteMany).toHaveBeenCalledWith({
      where: { announcementId: 'announcement_1', id: 'asset_1' },
    });
    expect(db.announcement.deleteMany).toHaveBeenCalledWith({
      where: { campusId: admin.campusId, id: 'announcement_1' },
    });
    expect(db.storageDeletionJob.upsert).toHaveBeenCalledWith({
      create: { storageKey: 'announcements/admin_1/asset_1' },
      update: {},
      where: { storageKey: 'announcements/admin_1/asset_1' },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: 'ANNOUNCEMENT_DELETED',
        actorId: admin.id,
        campusId: admin.campusId,
        details: { hadCover: true },
        subjectId: 'announcement_1',
        subjectType: 'ANNOUNCEMENT',
      },
    });
    expect(processDeletion).toHaveBeenCalledWith('job_1');
    expect(result).toEqual({
      id: 'announcement_1',
      storageDeletionQueued: false,
    });
  });

  it('does not roll back a committed database deletion when immediate storage processing fails', async () => {
    const db = adapter();
    await expect(
      deleteAnnouncement(db, admin, 'announcement_1', {
        processDeletion: vi.fn(async () => {
          throw new Error('private storage failure');
        }),
      }),
    ).resolves.toEqual({ id: 'announcement_1', storageDeletionQueued: true });
    expect(db.announcement.deleteMany).toHaveBeenCalledOnce();
  });

  it.each([
    ['retry', true],
    ['deferred', true],
    ['deleted', false],
    ['missing', false],
  ] as const)(
    'reports immediate storage result %s with queued=%s',
    async (status, storageDeletionQueued) => {
      await expect(
        deleteAnnouncement(adapter(), admin, 'announcement_1', {
          processDeletion: vi.fn(async () => ({ status })),
        }),
      ).resolves.toEqual({ id: 'announcement_1', storageDeletionQueued });
    },
  );

  it('returns the same not-found error for absent and cross-campus records', async () => {
    const db = adapter();
    vi.mocked(db.announcement.findFirst).mockResolvedValue(null);
    await expect(
      deleteAnnouncement(db, admin, 'secret_other_campus', {
        processDeletion: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(AnnouncementNotFoundError);
  });
});
