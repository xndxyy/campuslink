import { describe, expect, it, vi } from 'vitest';

import {
  AdminConflictError,
  AdminForbiddenError,
  AdminValidationError,
  updateCampusConfig,
  updateManagedUser,
  type AdministrationAdapter,
} from '@/lib/domain/administration';
import {
  listAuditLogs,
  sanitizeAuditDetails,
  type AuditAdapter,
} from '@/lib/domain/audit';

const admin = {
  campusId: 'campus_1',
  id: 'admin_1',
  role: 'ADMIN' as const,
};

function adapter() {
  const value = {
    $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation(value),
    ),
    auditLog: {
      create: vi.fn(async ({ data }) => ({ id: 'audit_1', ...data })),
      findMany: vi.fn(async () => []),
    },
    campus: {
      findFirst: vi.fn(async () => ({
        allowedEmailDomain: 'old.example.edu',
        id: 'campus_1',
        name: 'Old Campus',
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    session: { deleteMany: vi.fn(async () => ({ count: 2 })) },
    user: {
      count: vi.fn(async () => 2),
      findFirst: vi.fn(async () => ({
        campusId: 'campus_1',
        emailVerifiedAt: new Date(),
        id: 'user_1',
        role: 'MODERATOR',
        status: 'ACTIVE',
      })),
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  return value as unknown as AdministrationAdapter & AuditAdapter;
}

describe('administrator user controls', () => {
  it('changes a role in a serializable transaction, audits it, and revokes sessions', async () => {
    const db = adapter();
    await updateManagedUser(db, admin, {
      reason: 'Role no longer required for the current term.',
      role: 'STUDENT',
      userId: 'user_1',
    });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(db.user.updateMany).toHaveBeenCalledWith({
      data: { role: 'STUDENT' },
      where: {
        campusId: admin.campusId,
        id: 'user_1',
        role: 'MODERATOR',
        status: 'ACTIVE',
      },
    });
    expect(db.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'USER_ROLE_CHANGED',
        actorId: admin.id,
        campusId: admin.campusId,
        details: {
          from: 'MODERATOR',
          reason: 'Role no longer required for the current term.',
          to: 'STUDENT',
        },
      }),
    });
  });

  it('prevents the final active administrator from demotion or suspension', async () => {
    const db = adapter();
    vi.mocked(db.user.findFirst).mockResolvedValue({
      campusId: 'campus_1',
      emailVerifiedAt: new Date(),
      id: admin.id,
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    vi.mocked(db.user.count).mockResolvedValue(1);
    await expect(
      updateManagedUser(db, admin, {
        reason: 'Attempt to remove final administrator.',
        status: 'SUSPENDED',
        userId: admin.id,
      }),
    ).rejects.toBeInstanceOf(AdminConflictError);
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });

  it('does not promote a pending or unverified user to staff', async () => {
    const db = adapter();
    vi.mocked(db.user.findFirst).mockResolvedValue({
      campusId: 'campus_1',
      emailVerifiedAt: null,
      id: 'user_1',
      role: 'STUDENT',
      status: 'PENDING_VERIFICATION',
    });
    await expect(
      updateManagedUser(db, admin, {
        reason: 'Requested moderator assignment.',
        role: 'MODERATOR',
        userId: 'user_1',
      }),
    ).rejects.toBeInstanceOf(AdminConflictError);
  });

  it('revokes sessions for every ACTIVE to non-ACTIVE status transition', async () => {
    const db = adapter();
    await updateManagedUser(db, admin, {
      reason: 'Account returns to pending verification after identity review.',
      status: 'PENDING_VERIFICATION',
      userId: 'user_1',
    });
    expect(db.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
    });
  });

  it('denies moderators before user lookup', async () => {
    const db = adapter();
    await expect(
      updateManagedUser(
        db,
        { ...admin, role: 'MODERATOR' },
        {
          reason: 'Unauthorized role change attempt.',
          role: 'ADMIN',
          userId: 'user_1',
        },
      ),
    ).rejects.toBeInstanceOf(AdminForbiddenError);
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });

  it('retries bounded Prisma serialization failures before applying a final-admin change', async () => {
    const db = adapter();
    vi.mocked(db.$transaction).mockRejectedValueOnce({ code: 'P2034' });
    await expect(
      updateManagedUser(db, admin, {
        reason: 'Role no longer required after the governance handoff.',
        role: 'STUDENT',
        userId: 'user_1',
      }),
    ).resolves.toMatchObject({ id: 'user_1', role: 'STUDENT' });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });

  it.each([{ code: 'P2034' }, { code: '40001' }, { meta: { code: '40001' } }])(
    'maps exhausted serialization failure %j to a safe conflict',
    async (error) => {
      const db = adapter();
      vi.mocked(db.$transaction).mockRejectedValue(error);
      await expect(
        updateManagedUser(db, admin, {
          reason: 'Concurrent final administrator protection.',
          status: 'SUSPENDED',
          userId: 'user_1',
        }),
      ).rejects.toBeInstanceOf(AdminConflictError);
      expect(db.$transaction).toHaveBeenCalledTimes(3);
    },
  );
});

describe('campus settings and audit privacy', () => {
  it('updates the campus name and audits only the changed identity value', async () => {
    const db = adapter();
    await updateCampusConfig(db, admin, {
      name: 'Example University',
      reason: 'University domain migration completed.',
    });
    expect(db.campus.updateMany).toHaveBeenCalledWith({
      data: { name: 'Example University' },
      where: { id: admin.campusId },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CAMPUS_CONFIG_CHANGED',
        campusId: admin.campusId,
        details: {
          name: { from: 'Old Campus', to: 'Example University' },
          reason: 'University domain migration completed.',
        },
      }),
    });
  });

  it('rejects an invalid campus name', async () => {
    await expect(
      updateCampusConfig(adapter(), admin, {
        name: ' ',
        reason: 'University name correction requested.',
      }),
    ).rejects.toBeInstanceOf(AdminValidationError);
  });

  it('recursively removes passwords, tokens, contact data, and email from audit metadata', () => {
    expect(
      sanitizeAuditDetails({
        contact: 'private',
        nested: { passwordHash: 'hash', reason: 'safe', token: 'secret' },
        oldEmail: 'private@example.edu',
        status: 'ACTIVE',
      }),
    ).toEqual({ nested: { reason: 'safe' }, status: 'ACTIVE' });
  });

  it('lists audit records for ADMIN only with stable pagination and sanitized details', async () => {
    const db = adapter();
    vi.mocked(db.auditLog.findMany).mockResolvedValue([
      {
        action: 'USER_ROLE_CHANGED',
        createdAt: new Date('2026-07-12T10:00:00Z'),
        details: { reason: 'safe', sessionToken: 'secret' },
        id: 'audit_1',
      },
    ]);
    const result = await listAuditLogs(db, admin, { pageSize: 20 });
    expect(db.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 21,
        where: expect.objectContaining({ campusId: admin.campusId }),
      }),
    );
    expect(result.items[0]?.details).toEqual({ reason: 'safe' });
    await expect(
      listAuditLogs(db, { ...admin, role: 'MODERATOR' }, {}),
    ).rejects.toBeInstanceOf(AdminForbiddenError);
  });
});
