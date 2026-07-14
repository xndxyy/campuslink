import { AdminForbiddenError, AdminValidationError } from './administration';
import { sanitizeAuditDetails } from './audit-details';
import type { StaffActor } from './moderation';

export { sanitizeAuditDetails } from './audit-details';

export interface AuditAdapter {
  auditLog: {
    findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
}

const entityTypes = new Set([
  'CAMPUS',
  'USER',
  'ASSET',
  'ANNOUNCEMENT',
  'RESOURCE',
  'MARKETPLACE_ITEM',
  'JOB_POST',
  'REPORT',
  'TAG_DEFINITION',
]);
const allowedSearchKeys = new Set([
  'actor',
  'event',
  'entityType',
  'entityId',
  'from',
  'to',
  'pageSize',
  'cursor',
]);

export interface AuditQuery {
  action?: string;
  actorId?: string;
  cursor?: { createdAt: Date; id: string };
  from?: Date;
  pageSize?: number;
  subjectId?: string;
  subjectType?: string;
  to?: Date;
}

function requiredScalar(
  searchParams: URLSearchParams,
  key: string,
): string | undefined {
  const values = searchParams.getAll(key);
  if (values.length > 1)
    throw new AdminValidationError('Duplicate audit filter');
  const value = values[0]?.trim();
  return value || undefined;
}

function boundedString(value: string | undefined, maximum: number) {
  if (value && value.length > maximum) {
    throw new AdminValidationError('Audit filter is too long');
  }
  return value;
}

function dateFilter(value: string | undefined) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AdminValidationError('Invalid audit date');
  }
  return parsed;
}

export function encodeAuditCursor(cursor: { createdAt: Date; id: string }) {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
  ).toString('base64url');
}

function decodeAuditCursor(value: string | undefined) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    const id = typeof parsed.id === 'string' ? parsed.id.trim() : '';
    const createdAt = new Date(String(parsed.createdAt ?? ''));
    if (!id || id.length > 191 || Number.isNaN(createdAt.getTime())) {
      throw new Error('invalid cursor');
    }
    return { createdAt, id };
  } catch {
    throw new AdminValidationError('Invalid audit cursor');
  }
}

export function parseAuditQuery(searchParams: URLSearchParams): AuditQuery {
  for (const key of searchParams.keys()) {
    if (!allowedSearchKeys.has(key)) {
      throw new AdminValidationError('Unknown audit filter');
    }
  }
  const pageSizeValue = requiredScalar(searchParams, 'pageSize');
  if (pageSizeValue && !/^[1-9]\d*$/.test(pageSizeValue)) {
    throw new AdminValidationError('Invalid audit page size');
  }
  const pageSize = pageSizeValue ? Number(pageSizeValue) : undefined;
  if (pageSize && pageSize > 100) {
    throw new AdminValidationError('Invalid audit page size');
  }
  const subjectType = boundedString(
    requiredScalar(searchParams, 'entityType'),
    64,
  );
  if (subjectType && !entityTypes.has(subjectType)) {
    throw new AdminValidationError('Invalid audit entity type');
  }
  const from = dateFilter(requiredScalar(searchParams, 'from'));
  const to = dateFilter(requiredScalar(searchParams, 'to'));
  if (from && to && from > to) {
    throw new AdminValidationError('Invalid audit date range');
  }
  return {
    action: boundedString(requiredScalar(searchParams, 'event'), 100),
    actorId: boundedString(requiredScalar(searchParams, 'actor'), 191),
    cursor: decodeAuditCursor(requiredScalar(searchParams, 'cursor')),
    from,
    pageSize,
    subjectId: boundedString(requiredScalar(searchParams, 'entityId'), 191),
    subjectType,
    to,
  };
}

export async function listAuditLogs(
  adapter: AuditAdapter,
  actor: StaffActor,
  query: AuditQuery,
) {
  if (actor.role !== 'ADMIN') throw new AdminForbiddenError();
  const pageSize = Math.max(1, Math.min(query.pageSize ?? 50, 100));
  const records = await adapter.auditLog.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      action: true,
      actor: { select: { id: true, name: true } },
      actorId: true,
      createdAt: true,
      details: true,
      id: true,
      subjectId: true,
      subjectType: true,
    },
    take: pageSize + 1,
    where: {
      campusId: actor.campusId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(query.subjectType ? { subjectType: query.subjectType } : {}),
      ...(query.from || query.to
        ? { createdAt: { gte: query.from, lte: query.to } }
        : {}),
      ...(query.cursor
        ? {
            OR: [
              { createdAt: { lt: query.cursor.createdAt } },
              {
                createdAt: query.cursor.createdAt,
                id: { lt: query.cursor.id },
              },
            ],
          }
        : {}),
    },
  });
  const hasNextPage = records.length > pageSize;
  const items: Record<string, unknown>[] = records
    .slice(0, pageSize)
    .map((record) => ({
      ...record,
      details: sanitizeAuditDetails(record.details),
    }));
  const last = items.at(-1);
  return {
    hasNextPage,
    items,
    nextCursor:
      hasNextPage && last
        ? encodeAuditCursor({
            createdAt: last.createdAt as Date,
            id: String(last.id),
          })
        : null,
  };
}
