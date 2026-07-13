import type { StaffActor, StaffRole } from './moderation';
import { sanitizeAuditDetails } from './audit-details';

export type ManagedUserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';

export interface ManagedUserCursor {
  createdAt: Date;
  id: string;
}

export interface ManagedUserQuery {
  cursor?: ManagedUserCursor;
  pageSize?: number;
  role?: StaffRole;
  search?: string;
  status?: ManagedUserStatus;
  verified?: boolean;
}

export type ManagedUserDetailTab =
  'overview' | 'submissions' | 'reports' | 'audit';

export interface ParsedManagedUsersQuery {
  query: ManagedUserQuery;
  tab: ManagedUserDetailTab;
  userId?: string;
}

export interface ManagedUserListItem {
  createdAt: Date;
  email: string;
  emailVerifiedAt: Date | null;
  id: string;
  name: string | null;
  role: StaffRole;
  status: ManagedUserStatus;
}

export interface ManagedUserListResult {
  counts: {
    active: number;
    staff: number;
    suspended: number;
    total: number;
    unverified: number;
  };
  hasNextPage: boolean;
  items: ManagedUserListItem[];
  nextCursor: string | null;
}

const managedUserQueryKeys = new Set([
  'search',
  'role',
  'status',
  'verified',
  'pageSize',
  'cursor',
  'user',
  'tab',
]);
const managedUserRoles = new Set<StaffRole>(['STUDENT', 'MODERATOR', 'ADMIN']);
const managedUserStatuses = new Set<ManagedUserStatus>([
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
]);
const managedUserTabs = new Set<ManagedUserDetailTab>([
  'overview',
  'submissions',
  'reports',
  'audit',
]);

interface CreateDelegate {
  create(args: {
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}

interface CountAndFindManyDelegate {
  count(args: Record<string, unknown>): Promise<number>;
  findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
}

export interface AdministrationAdapter {
  $transaction<T>(
    operation: (tx: AdministrationAdapter) => Promise<T>,
    options?: { isolationLevel: 'Serializable' },
  ): Promise<T>;
  auditLog: CreateDelegate & {
    findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
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
    count(args: Record<string, unknown>): Promise<number>;
    deleteMany(args: Record<string, unknown>): Promise<{ count: number }>;
  };
  jobPost: CountAndFindManyDelegate;
  marketplaceItem: CountAndFindManyDelegate;
  report: CountAndFindManyDelegate;
  resource: CountAndFindManyDelegate;
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

function managedUserScalar(
  searchParams: URLSearchParams,
  key: string,
  allowEmpty = false,
) {
  const values = searchParams.getAll(key);
  if (values.length > 1) {
    throw new AdminValidationError('Duplicate user management filter');
  }
  if (values.length === 0) return undefined;
  const value = values[0]!.trim();
  if (!value && !allowEmpty) {
    throw new AdminValidationError('Invalid user management filter');
  }
  return value || undefined;
}

function decodeManagedUserCursor(value: string | undefined) {
  if (!value) return undefined;
  if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AdminValidationError('Invalid user management cursor');
  }
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) throw new Error('cursor');
    const parsed = JSON.parse(decoded.toString('utf8')) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('cursor');
    }
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).sort().join(',') !== 'createdAt,id') {
      throw new Error('cursor');
    }
    if (typeof record.createdAt !== 'string' || typeof record.id !== 'string') {
      throw new Error('cursor');
    }
    const createdAt = new Date(record.createdAt);
    const id = record.id.trim();
    if (
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString() !== record.createdAt ||
      !id ||
      id !== record.id ||
      id.length > 191
    ) {
      throw new Error('cursor');
    }
    return { createdAt, id };
  } catch {
    throw new AdminValidationError('Invalid user management cursor');
  }
}

export function parseManagedUsersQuery(
  searchParams: URLSearchParams,
): ParsedManagedUsersQuery {
  for (const key of searchParams.keys()) {
    if (!managedUserQueryKeys.has(key)) {
      throw new AdminValidationError('Unknown user management filter');
    }
  }
  const search = managedUserScalar(searchParams, 'search', true);
  if (search && search.length > 200) {
    throw new AdminValidationError('User management search is too long');
  }
  const roleValue = managedUserScalar(searchParams, 'role');
  if (roleValue && !managedUserRoles.has(roleValue as StaffRole)) {
    throw new AdminValidationError('Invalid user management role');
  }
  const statusValue = managedUserScalar(searchParams, 'status');
  if (
    statusValue &&
    !managedUserStatuses.has(statusValue as ManagedUserStatus)
  ) {
    throw new AdminValidationError('Invalid user management status');
  }
  const verifiedValue = managedUserScalar(searchParams, 'verified');
  if (
    verifiedValue !== undefined &&
    verifiedValue !== 'true' &&
    verifiedValue !== 'false'
  ) {
    throw new AdminValidationError('Invalid user verification filter');
  }
  const pageSizeValue = managedUserScalar(searchParams, 'pageSize');
  if (pageSizeValue && !/^[1-9]\d*$/.test(pageSizeValue)) {
    throw new AdminValidationError('Invalid user management page size');
  }
  const pageSize = pageSizeValue ? Number(pageSizeValue) : 25;
  if (pageSize > 100) {
    throw new AdminValidationError('Invalid user management page size');
  }
  const cursor = decodeManagedUserCursor(
    managedUserScalar(searchParams, 'cursor'),
  );
  const userId = managedUserScalar(searchParams, 'user');
  if (userId && userId.length > 191) {
    throw new AdminValidationError('Invalid selected user');
  }
  const tabValue = managedUserScalar(searchParams, 'tab');
  if (tabValue && !managedUserTabs.has(tabValue as ManagedUserDetailTab)) {
    throw new AdminValidationError('Invalid user detail tab');
  }
  return {
    query: {
      ...(cursor ? { cursor } : {}),
      pageSize,
      ...(roleValue ? { role: roleValue as StaffRole } : {}),
      ...(search ? { search } : {}),
      ...(statusValue ? { status: statusValue as ManagedUserStatus } : {}),
      ...(verifiedValue === undefined
        ? {}
        : { verified: verifiedValue === 'true' }),
    },
    tab: (tabValue as ManagedUserDetailTab | undefined) ?? 'overview',
    ...(userId ? { userId } : {}),
  };
}

export function buildManagedUsersHref(
  current: URLSearchParams,
  updates: Record<string, string | null>,
) {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query ? `/admin/users?${query}` : '/admin/users';
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
  query: ManagedUserQuery = {},
): Promise<ManagedUserListResult> {
  requireAdmin(actor);
  const pageSize = Math.max(1, Math.min(query.pageSize ?? 25, 100));
  const filters: Record<string, unknown>[] = [];
  if (query.search) {
    filters.push({
      OR: [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ],
    });
  }
  if (query.cursor) {
    filters.push({
      OR: [
        { createdAt: { lt: query.cursor.createdAt } },
        {
          createdAt: query.cursor.createdAt,
          id: { lt: query.cursor.id },
        },
      ],
    });
  }
  const [records, total, active, suspended, unverified, staff] =
    await Promise.all([
      adapter.user.findMany({
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
        take: pageSize + 1,
        where: {
          ...(filters.length > 0 ? { AND: filters } : {}),
          campusId: actor.campusId,
          ...(query.verified === undefined
            ? {}
            : query.verified
              ? { emailVerifiedAt: { not: null } }
              : { emailVerifiedAt: null }),
          ...(query.role ? { role: query.role } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
      }),
      adapter.user.count({ where: { campusId: actor.campusId } }),
      adapter.user.count({
        where: { campusId: actor.campusId, status: 'ACTIVE' },
      }),
      adapter.user.count({
        where: { campusId: actor.campusId, status: 'SUSPENDED' },
      }),
      adapter.user.count({
        where: { campusId: actor.campusId, emailVerifiedAt: null },
      }),
      adapter.user.count({
        where: {
          campusId: actor.campusId,
          role: { in: ['MODERATOR', 'ADMIN'] },
        },
      }),
    ]);
  const items = records.slice(0, pageSize) as unknown as ManagedUserListItem[];
  const hasNextPage = records.length > pageSize;
  const last = items.at(-1);
  return {
    counts: { active, staff, suspended, total, unverified },
    hasNextPage,
    items,
    nextCursor:
      hasNextPage && last
        ? encodeManagedUserCursor({
            createdAt: last.createdAt as Date,
            id: String(last.id),
          })
        : null,
  };
}

export function encodeManagedUserCursor(cursor: ManagedUserCursor) {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
  ).toString('base64url');
}

export interface ManagedUserDetail {
  audit: { recent: Record<string, unknown>[] };
  overview: Record<string, unknown> & { activeSessionCount: number };
  reports: {
    recent: Record<string, unknown>[];
    submittedCount: number;
  };
  submissions: {
    jobPosts: { recent: Record<string, unknown>[]; total: number };
    marketplaceItems: { recent: Record<string, unknown>[]; total: number };
    resources: { recent: Record<string, unknown>[]; total: number };
  };
}

export async function getManagedUserDetail(
  adapter: AdministrationAdapter,
  actor: StaffActor,
  userId: string,
): Promise<ManagedUserDetail> {
  requireAdmin(actor);
  const user = await adapter.user.findFirst({
    select: {
      createdAt: true,
      email: true,
      emailVerifiedAt: true,
      id: true,
      name: true,
      role: true,
      status: true,
    },
    where: { campusId: actor.campusId, id: userId },
  });
  if (!user) throw new AdminConflictError();

  const recentContentQuery = {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { createdAt: true, id: true, status: true, title: true },
    take: 10,
  };
  const [
    activeSessionCount,
    resourceCount,
    resources,
    marketplaceItemCount,
    marketplaceItems,
    jobPostCount,
    jobPosts,
    submittedReportCount,
    reports,
    audit,
  ] = await Promise.all([
    adapter.session.count({
      where: { expires: { gt: new Date() }, userId },
    }),
    adapter.resource.count({
      where: { authorId: userId, campusId: actor.campusId },
    }),
    adapter.resource.findMany({
      ...recentContentQuery,
      where: { authorId: userId, campusId: actor.campusId },
    }),
    adapter.marketplaceItem.count({
      where: { campusId: actor.campusId, sellerId: userId },
    }),
    adapter.marketplaceItem.findMany({
      ...recentContentQuery,
      where: { campusId: actor.campusId, sellerId: userId },
    }),
    adapter.jobPost.count({
      where: { authorId: userId, campusId: actor.campusId },
    }),
    adapter.jobPost.findMany({
      ...recentContentQuery,
      where: { authorId: userId, campusId: actor.campusId },
    }),
    adapter.report.count({
      where: { campusId: actor.campusId, reporterId: userId },
    }),
    adapter.report.findMany({
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
      where: { campusId: actor.campusId, reporterId: userId },
    }),
    adapter.auditLog.findMany({
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
        campusId: actor.campusId,
        subjectId: userId,
        subjectType: 'USER',
      },
    }),
  ]);

  return {
    audit: {
      recent: audit.map((entry) => ({
        ...entry,
        details: sanitizeAuditDetails(entry.details),
      })),
    },
    overview: { ...user, activeSessionCount },
    reports: { recent: reports, submittedCount: submittedReportCount },
    submissions: {
      jobPosts: { recent: jobPosts, total: jobPostCount },
      marketplaceItems: {
        recent: marketplaceItems,
        total: marketplaceItemCount,
      },
      resources: { recent: resources, total: resourceCount },
    },
  };
}

export async function revokeManagedUserSessions(
  adapter: AdministrationAdapter,
  actor: StaffActor,
  input: { reason: string; userId: string },
) {
  requireAdmin(actor);
  const reason = adminReason(input.reason);
  return adapter.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      select: { id: true },
      where: { campusId: actor.campusId, id: input.userId },
    });
    if (!user) throw new AdminConflictError();
    const revoked = await tx.session.deleteMany({
      where: { userId: input.userId },
    });
    await tx.auditLog.create({
      data: {
        action: 'USER_SESSIONS_REVOKED',
        actorId: actor.id,
        campusId: actor.campusId,
        details: { reason, revokedCount: revoked.count },
        subjectId: input.userId,
        subjectType: 'USER',
      },
    });
    return { revokedCount: revoked.count };
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
