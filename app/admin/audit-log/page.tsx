import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireRole } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import {
  listAuditLogs,
  parseAuditQuery,
  type AuditAdapter,
} from '@/lib/domain/audit';

type AuditSearchParams = Record<string, string | string[] | undefined>;

function toUrlSearchParams(input: AuditSearchParams) {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(key, item);
    } else if (value !== undefined) {
      result.set(key, value);
    }
  }
  return result;
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<AuditSearchParams>;
}) {
  const values = toUrlSearchParams(await searchParams);
  let records: Record<string, unknown>[];
  let nextCursor: string | null;
  try {
    const user = await requireRole(['ADMIN']);
    const result = await listAuditLogs(
      getDb() as unknown as AuditAdapter,
      { campusId: user.campusId, id: user.id, role: user.role },
      parseAuditQuery(values),
    );
    records = result.items;
    nextCursor = result.nextCursor;
  } catch {
    notFound();
  }
  const nextSearchParams = new URLSearchParams(values);
  if (nextCursor) nextSearchParams.set('cursor', nextCursor);
  return (
    <section>
      <header className="admin-masthead">
        <p className="eyebrow">Immutable campus record</p>
        <h2>Audit log</h2>
        <p>
          Stable newest-first entries; secret, credential, contact, and token
          fields are removed before display.
        </p>
      </header>
      <form className="admin-filter" method="get">
        <label>
          Event
          <input defaultValue={values.get('event') ?? ''} name="event" />
        </label>
        <label>
          Actor ID
          <input defaultValue={values.get('actor') ?? ''} name="actor" />
        </label>
        <label>
          Entity type
          <select
            defaultValue={values.get('entityType') ?? ''}
            name="entityType"
          >
            <option value="">All</option>
            {[
              'CAMPUS',
              'USER',
              'ASSET',
              'RESOURCE',
              'MARKETPLACE_ITEM',
              'JOB_POST',
              'REPORT',
            ].map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label>
          Entity ID
          <input defaultValue={values.get('entityId') ?? ''} name="entityId" />
        </label>
        <label>
          From
          <input
            defaultValue={values.get('from') ?? ''}
            name="from"
            type="datetime-local"
          />
        </label>
        <label>
          To
          <input
            defaultValue={values.get('to') ?? ''}
            name="to"
            type="datetime-local"
          />
        </label>
        <label>
          Page size
          <input
            defaultValue={values.get('pageSize') ?? '50'}
            max={100}
            min={1}
            name="pageSize"
            type="number"
          />
        </label>
        <input name="cursor" type="hidden" value="" />
        <button type="submit">Filter</button>
      </form>
      {records.length === 0 ? (
        <div className="empty-state">
          <h2>No audit entries match.</h2>
        </div>
      ) : (
        <ol className="audit-list">
          {records.map((record) => (
            <li key={String(record.id)}>
              <time>{new Date(String(record.createdAt)).toLocaleString()}</time>
              <strong>{String(record.action)}</strong>
              <span>
                {String(record.subjectType ?? 'SYSTEM')} ·{' '}
                {String(record.subjectId ?? '—')}
              </span>
              <pre>{JSON.stringify(record.details ?? {}, null, 2)}</pre>
            </li>
          ))}
        </ol>
      )}
      {nextCursor ? (
        <Link href={`?${nextSearchParams.toString()}`}>Next page</Link>
      ) : null}
    </section>
  );
}
