import { describe, expect, it, vi } from 'vitest';

import * as administration from '@/lib/domain/administration';

import {
  AdminConflictError,
  AdminForbiddenError,
  AdminValidationError,
  encodeManagedUserCursor,
  listManagedUsers,
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
    jobPost: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
    },
    marketplaceItem: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
    },
    report: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
    },
    resource: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
    },
    session: {
      count: vi.fn(async () => 0),
      deleteMany: vi.fn(async () => ({ count: 2 })),
    },
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

function managedUserDetailReader() {
  const read = (
    administration as unknown as {
      getManagedUserDetail?: (
        db: AdministrationAdapter,
        actor: typeof admin,
        userId: string,
      ) => Promise<Record<string, unknown>>;
    }
  ).getManagedUserDetail;
  expect(read).toBeTypeOf('function');
  return read!;
}

function managedUserSessionRevoker() {
  const revoke = (
    administration as unknown as {
      revokeManagedUserSessions?: (
        db: AdministrationAdapter,
        actor: typeof admin,
        input: { reason: string; userId: string },
      ) => Promise<{ revokedCount: number }>;
    }
  ).revokeManagedUserSessions;
  expect(revoke).toBeTypeOf('function');
  return revoke!;
}

function managedUserQueryParser() {
  const parse = (
    administration as unknown as {
      parseManagedUsersQuery?: (params: URLSearchParams) => unknown;
    }
  ).parseManagedUsersQuery;
  expect(parse).toBeTypeOf('function');
  return parse!;
}

describe('managed user query parsing', () => {
  it('decodes the opaque cursor and separates list filters from UI state', () => {
    const cursor = encodeManagedUserCursor({
      createdAt: new Date('2026-07-14T10:00:00.000Z'),
      id: 'user_9',
    });
    const parsed = managedUserQueryParser()(
      new URLSearchParams({
        cursor,
        pageSize: '40',
        role: 'MODERATOR',
        search: '  Alice  ',
        status: 'ACTIVE',
        tab: 'audit',
        user: 'user_1',
        verified: 'false',
      }),
    );
    expect(parsed).toEqual({
      query: {
        cursor: {
          createdAt: new Date('2026-07-14T10:00:00.000Z'),
          id: 'user_9',
        },
        pageSize: 40,
        role: 'MODERATOR',
        search: 'Alice',
        status: 'ACTIVE',
        verified: false,
      },
      tab: 'audit',
      userId: 'user_1',
    });
  });

  it.each([
    ['unknown key', 'extra=value'],
    ['duplicate key', 'role=ADMIN&role=MODERATOR'],
    ['long search', `search=${'a'.repeat(201)}`],
    ['invalid role', 'role=OWNER'],
    ['invalid status', 'status=DISABLED'],
    ['invalid boolean', 'verified=1'],
    ['zero page size', 'pageSize=0'],
    ['large page size', 'pageSize=101'],
    ['decimal page size', 'pageSize=2.5'],
    ['invalid cursor', 'cursor=not-a-cursor'],
    ['invalid selected user', 'user='],
    ['invalid tab', 'tab=history'],
  ])('rejects %s', (_label, query) => {
    expect(() => managedUserQueryParser()(new URLSearchParams(query))).toThrow(
      AdminValidationError,
    );
  });
});

describe('administrator user controls', () => {
  it('always audits an explicit same-campus session revocation inside a transaction', async () => {
    const db = adapter();
    vi.mocked(db.session.deleteMany).mockResolvedValue({ count: 0 });
    await expect(
      managedUserSessionRevoker()(db, admin, {
        reason: '  Security review completed for all active devices.  ',
        userId: 'user_1',
      }),
    ).resolves.toEqual({ revokedCount: 0 });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function));
    expect(db.user.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: { campusId: admin.campusId, id: 'user_1' },
    });
    expect(db.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: 'USER_SESSIONS_REVOKED',
        actorId: admin.id,
        campusId: admin.campusId,
        details: {
          reason: 'Security review completed for all active devices.',
          revokedCount: 0,
        },
        subjectId: 'user_1',
        subjectType: 'USER',
      },
    });
  });

  it('rejects invalid revocation reasons and cross-campus targets safely', async () => {
    const db = adapter();
    await expect(
      managedUserSessionRevoker()(db, admin, {
        reason: 'no',
        userId: 'user_1',
      }),
    ).rejects.toBeInstanceOf(AdminValidationError);
    expect(db.$transaction).not.toHaveBeenCalled();

    vi.mocked(db.user.findFirst).mockResolvedValue(null);
    await expect(
      managedUserSessionRevoker()(db, admin, {
        reason: 'Security review requests a complete sign-out.',
        userId: 'other-campus-user',
      }),
    ).rejects.toBeInstanceOf(AdminConflictError);
    expect(db.session.deleteMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('returns bounded same-campus detail for the four governance tabs', async () => {
    const db = adapter();
    const createdAt = new Date('2026-07-10T10:00:00.000Z');
    vi.mocked(db.user.findFirst).mockResolvedValue({
      createdAt,
      email: 'managed@example.edu',
      emailVerifiedAt: new Date('2026-07-11T10:00:00.000Z'),
      id: 'user_1',
      name: 'Managed User',
      role: 'STUDENT',
      status: 'ACTIVE',
    });
    vi.mocked(db.session.count).mockResolvedValue(2);
    vi.mocked(db.resource.count).mockResolvedValue(12);
    vi.mocked(db.marketplaceItem.count).mockResolvedValue(3);
    vi.mocked(db.jobPost.count).mockResolvedValue(1);
    vi.mocked(db.report.count).mockResolvedValue(4);
    vi.mocked(db.resource.findMany).mockResolvedValue([
      { createdAt, id: 'resource_1', status: 'PUBLISHED', title: 'Notes' },
    ]);
    vi.mocked(db.marketplaceItem.findMany).mockResolvedValue([
      { createdAt, id: 'item_1', status: 'PUBLISHED', title: 'Book' },
    ]);
    vi.mocked(db.jobPost.findMany).mockResolvedValue([
      { createdAt, id: 'job_1', status: 'PUBLISHED', title: 'Assistant' },
    ]);
    vi.mocked(db.report.findMany).mockResolvedValue([
      {
        createdAt,
        id: 'report_1',
        reason: 'SPAM',
        status: 'OPEN',
        targetId: 'resource_2',
        targetType: 'RESOURCE',
      },
    ]);
    vi.mocked(db.auditLog.findMany).mockResolvedValue([
      {
        action: 'USER_SESSIONS_REVOKED',
        createdAt,
        details: {
          email: 'private@example.edu',
          nested: { reason: 'Security review', sessionToken: 'private' },
        },
        id: 'audit_1',
      },
    ]);

    const result = await managedUserDetailReader()(db, admin, 'user_1');

    expect(db.user.findFirst).toHaveBeenCalledWith({
      select: {
        createdAt: true,
        email: true,
        emailVerifiedAt: true,
        id: true,
        name: true,
        role: true,
        status: true,
      },
      where: { campusId: admin.campusId, id: 'user_1' },
    });
    expect(db.session.count).toHaveBeenCalledWith({
      where: { expires: { gt: expect.any(Date) }, userId: 'user_1' },
    });
    expect(db.resource.findMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { createdAt: true, id: true, status: true, title: true },
      take: 10,
      where: { authorId: 'user_1', campusId: admin.campusId },
    });
    expect(db.marketplaceItem.findMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { createdAt: true, id: true, status: true, title: true },
      take: 10,
      where: { campusId: admin.campusId, sellerId: 'user_1' },
    });
    expect(db.report.findMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        createdAt: true,
        id: true,
        reason: true,
        status: true,
        targetId: true,
        targetType: true,
      },
      take: 10,
      where: { campusId: admin.campusId, reporterId: 'user_1' },
    });
    expect(db.auditLog.findMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        action: true,
        actor: { select: { id: true, name: true } },
        actorId: true,
        createdAt: true,
        details: true,
        id: true,
      },
      take: 20,
      where: {
        campusId: admin.campusId,
        subjectId: 'user_1',
        subjectType: 'USER',
      },
    });
    expect(result).toMatchObject({
      audit: {
        recent: [
          {
            details: { nested: { reason: 'Security review' } },
          },
        ],
      },
      overview: {
        activeSessionCount: 2,
        email: 'managed@example.edu',
        id: 'user_1',
      },
      reports: { submittedCount: 4 },
      submissions: {
        jobPosts: { total: 1 },
        marketplaceItems: { total: 3 },
        resources: { total: 12 },
      },
    });
  });

  it('maps an absent or cross-campus managed user to the same safe conflict', async () => {
    const db = adapter();
    vi.mocked(db.user.findFirst).mockResolvedValue(null);
    await expect(
      managedUserDetailReader()(db, admin, 'other-campus-user'),
    ).rejects.toBeInstanceOf(AdminConflictError);
    expect(db.session.count).not.toHaveBeenCalled();
    expect(db.resource.findMany).not.toHaveBeenCalled();
  });

  it('lists a campus-scoped filtered cursor page with stable unfiltered counts', async () => {
    const db = adapter();
    const first = {
      createdAt: new Date('2026-07-13T12:00:00.000Z'),
      email: 'first@example.edu',
      emailVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
      id: 'user_2',
      name: 'First User',
      role: 'MODERATOR',
      status: 'ACTIVE',
    };
    const second = {
      ...first,
      createdAt: new Date('2026-07-12T12:00:00.000Z'),
      email: 'second@example.edu',
      id: 'user_1',
      name: 'Second User',
    };
    vi.mocked(db.user.findMany).mockResolvedValue([first, second]);
    vi.mocked(db.user.count)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(3);

    const result = await listManagedUsers(db, admin, {
      cursor: {
        createdAt: new Date('2026-07-14T12:00:00.000Z'),
        id: 'user_9',
      },
      pageSize: 1,
      role: 'MODERATOR',
      search: 'first',
      status: 'ACTIVE',
      verified: true,
    });

    expect(db.user.findMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        createdAt: true,
        email: true,
        emailVerifiedAt: true,
        id: true,
        name: true,
        role: true,
        status: true,
      },
      take: 2,
      where: {
        AND: [
          {
            OR: [
              { name: { contains: 'first', mode: 'insensitive' } },
              { email: { contains: 'first', mode: 'insensitive' } },
            ],
          },
          {
            OR: [
              { createdAt: { lt: new Date('2026-07-14T12:00:00.000Z') } },
              {
                createdAt: new Date('2026-07-14T12:00:00.000Z'),
                id: { lt: 'user_9' },
              },
            ],
          },
        ],
        campusId: admin.campusId,
        emailVerifiedAt: { not: null },
        role: 'MODERATOR',
        status: 'ACTIVE',
      },
    });
    expect(db.user.count).toHaveBeenNthCalledWith(1, {
      where: { campusId: admin.campusId },
    });
    expect(db.user.count).toHaveBeenNthCalledWith(4, {
      where: { campusId: admin.campusId, emailVerifiedAt: null },
    });
    expect(db.user.count).toHaveBeenNthCalledWith(5, {
      where: {
        campusId: admin.campusId,
        role: { in: ['MODERATOR', 'ADMIN'] },
      },
    });
    expect(result).toEqual({
      counts: {
        active: 5,
        staff: 3,
        suspended: 2,
        total: 8,
        unverified: 1,
      },
      hasNextPage: true,
      items: [first],
      nextCursor: expect.any(String),
    });
  });

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
