import { AdminForbiddenError } from './administration';
import type { StaffActor } from './moderation';

export interface AuditAdapter {
  auditLog: {
    findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
}

const unsafeKey = /(?:password|token|secret|contact|session|credential)/i;
const unsafeEmailKey = /(?:^email$|emailAddress|oldEmail|newEmail)/i;

export function sanitizeAuditDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuditDetails);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !unsafeKey.test(key) && !unsafeEmailKey.test(key))
      .map(([key, nested]) => [key, sanitizeAuditDetails(nested)]),
  );
}

export async function listAuditLogs(
  adapter: AuditAdapter,
  actor: StaffActor,
  query: {
    action?: string;
    actorId?: string;
    cursor?: { createdAt: Date; id: string };
    from?: Date;
    pageSize?: number;
    subjectId?: string;
    subjectType?: string;
    to?: Date;
  },
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
        ? { createdAt: last.createdAt as Date, id: String(last.id) }
        : null,
  };
}
