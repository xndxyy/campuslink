import type { StaffActor, StaffRole } from './moderation';

export type ManagedUserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';

interface CreateDelegate {
  create(args: {
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}

export interface AdministrationAdapter {
  $transaction<T>(
    operation: (tx: AdministrationAdapter) => Promise<T>,
    options?: { isolationLevel: 'Serializable' },
  ): Promise<T>;
  auditLog: CreateDelegate;
  campus: {
    findFirst(
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown> | null>;
    updateMany(args: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  session: {
    deleteMany(args: Record<string, unknown>): Promise<{ count: number }>;
  };
  user: {
    count(args: Record<string, unknown>): Promise<number>;
    findFirst(
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown> | null>;
    findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
    updateMany(args: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
}

export class AdminForbiddenError extends Error {
  constructor() {
    super('Administrator access is required');
  }
}

export class AdminValidationError extends Error {
  constructor(message = 'Invalid administration input') {
    super(message);
  }
}

export class AdminConflictError extends Error {
  constructor(message = 'Administration state conflict') {
    super(message);
  }
}

function requireAdmin(actor: StaffActor) {
  if (actor.role !== 'ADMIN') throw new AdminForbiddenError();
}

function adminReason(reason: string) {
  const value = reason.trim();
  if (value.length < 5 || value.length > 1000) {
    throw new AdminValidationError(
      'A reason between 5 and 1000 characters is required',
    );
  }
  return value;
}

function isSerializationFailure(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: unknown;
    meta?: { code?: unknown };
  };
  return (
    candidate.code === 'P2034' ||
    candidate.code === '40001' ||
    candidate.meta?.code === '40001'
  );
}

async function serializableTransaction<T>(
  adapter: AdministrationAdapter,
  operation: (tx: AdministrationAdapter) => Promise<T>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await adapter.$transaction(operation, {
        isolationLevel: 'Serializable',
      });
    } catch (error) {
      if (!isSerializationFailure(error)) throw error;
      if (attempt === 2) {
        throw new AdminConflictError('Concurrent administration change');
      }
    }
  }
  throw new AdminConflictError('Concurrent administration change');
}

export async function listManagedUsers(
  adapter: AdministrationAdapter,
  actor: StaffActor,
  query: {
    page?: number;
    pageSize?: number;
    role?: StaffRole;
    status?: ManagedUserStatus;
  } = {},
) {
  requireAdmin(actor);
  const page = Math.max(1, Math.min(query.page ?? 1, 100));
  const pageSize = Math.max(1, Math.min(query.pageSize ?? 25, 100));
  return adapter.user.findMany({
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
    skip: (page - 1) * pageSize,
    take: pageSize,
    where: {
      campusId: actor.campusId,
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
    },
  });
}

const roleRank: Record<StaffRole, number> = {
  ADMIN: 2,
  MODERATOR: 1,
  STUDENT: 0,
};

export async function updateManagedUser(
  adapter: AdministrationAdapter,
  actor: StaffActor,
  input: {
    reason: string;
    role?: StaffRole;
    status?: ManagedUserStatus;
    userId: string;
  },
) {
  requireAdmin(actor);
  const reason = adminReason(input.reason);
  if ((!input.role && !input.status) || (input.role && input.status)) {
    throw new AdminValidationError('Change exactly one user property');
  }
  return serializableTransaction(adapter, async (tx) => {
    const user = await tx.user.findFirst({
      select: {
        campusId: true,
        emailVerifiedAt: true,
        id: true,
        role: true,
        status: true,
      },
      where: { campusId: actor.campusId, id: input.userId },
    });
    if (!user) throw new AdminConflictError();
    const currentRole = user.role as StaffRole;
    const currentStatus = user.status as ManagedUserStatus;
    if (
      input.role &&
      input.role !== 'STUDENT' &&
      (currentStatus !== 'ACTIVE' || !user.emailVerifiedAt)
    ) {
      throw new AdminConflictError(
        'Pending or unverified users cannot be staff',
      );
    }
    const removesActiveAdmin =
      currentRole === 'ADMIN' &&
      currentStatus === 'ACTIVE' &&
      ((input.role !== undefined && input.role !== 'ADMIN') ||
        (input.status !== undefined && input.status !== 'ACTIVE'));
    if (removesActiveAdmin) {
      const activeAdmins = await tx.user.count({
        where: {
          campusId: actor.campusId,
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });
      if (activeAdmins <= 1) throw new AdminConflictError('Final active admin');
    }

    const data = input.role ? { role: input.role } : { status: input.status };
    const changed = await tx.user.updateMany({
      data,
      where: {
        campusId: actor.campusId,
        id: input.userId,
        role: currentRole,
        status: currentStatus,
      },
    });
    if (changed.count !== 1) throw new AdminConflictError();

    const revokeSessions =
      (input.status !== undefined &&
        currentStatus === 'ACTIVE' &&
        input.status !== 'ACTIVE') ||
      (input.role !== undefined &&
        roleRank[input.role] < roleRank[currentRole]);
    if (revokeSessions) {
      await tx.session.deleteMany({ where: { userId: input.userId } });
    }
    const action = input.role ? 'USER_ROLE_CHANGED' : 'USER_STATUS_CHANGED';
    const details = input.role
      ? { from: currentRole, reason, to: input.role }
      : { from: currentStatus, reason, to: input.status };
    await tx.auditLog.create({
      data: {
        action,
        actorId: actor.id,
        campusId: actor.campusId,
        details,
        subjectId: input.userId,
        subjectType: 'USER',
      },
    });
    return { id: input.userId, ...data, sessionsRevoked: revokeSessions };
  });
}

export async function updateCampusConfig(
  adapter: AdministrationAdapter,
  actor: StaffActor,
  input: { name: string; reason: string },
) {
  requireAdmin(actor);
  const reason = adminReason(input.reason);
  const name = input.name.trim();
  if (name.length < 2 || name.length > 200) {
    throw new AdminValidationError('Invalid campus configuration');
  }
  return adapter.$transaction(async (tx) => {
    const campus = await tx.campus.findFirst({
      select: { id: true, name: true },
      where: { id: actor.campusId },
    });
    if (!campus) throw new AdminConflictError();
    const changed = await tx.campus.updateMany({
      data: { name },
      where: { id: actor.campusId },
    });
    if (changed.count !== 1) throw new AdminConflictError();
    await tx.auditLog.create({
      data: {
        action: 'CAMPUS_CONFIG_CHANGED',
        actorId: actor.id,
        campusId: actor.campusId,
        details: {
          name: { from: campus.name, to: name },
          reason,
        },
        subjectId: actor.campusId,
        subjectType: 'CAMPUS',
      },
    });
    return { id: actor.campusId, name };
  });
}
