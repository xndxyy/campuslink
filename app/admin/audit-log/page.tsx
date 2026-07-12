import { notFound } from 'next/navigation';

import { requireRole } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import { listAuditLogs, type AuditAdapter } from '@/lib/domain/audit';

export default async function AuditLogPage() {
  let records: Record<string, unknown>[];
  try {
    const user = await requireRole(['ADMIN']);
    const result = await listAuditLogs(
      getDb() as unknown as AuditAdapter,
      { campusId: user.campusId, id: user.id, role: user.role },
      {},
    );
    records = result.items;
  } catch {
    notFound();
  }
  return (
    <section>
      <header className="admin-masthead">
        <p className="eyebrow">Immutable record</p>
        <h2>Audit log</h2>
        <p>
          Stable newest-first entries; secret, credential, contact, and token
          fields are removed before display.
        </p>
      </header>
      <form className="admin-filter" method="get">
        <label>
          Event
          <input name="action" />
        </label>
        <label>
          Actor ID
          <input name="actorId" />
        </label>
        <label>
          Entity type
          <input name="subjectType" />
        </label>
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
    </section>
  );
}
