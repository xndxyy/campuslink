import Link from 'next/link';

import { ReportActionForm } from '@/components/admin/report-action-form';
import { requireRole } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import {
  listModerationReports,
  type ModerationAdapter,
} from '@/lib/domain/moderation';

async function loadReports() {
  try {
    const user = await requireRole(['MODERATOR', 'ADMIN']);
    return {
      error: false,
      items: await listModerationReports(
        getDb() as unknown as ModerationAdapter,
        { campusId: user.campusId, id: user.id, role: user.role },
      ),
    };
  } catch {
    return { error: true, items: [] };
  }
}

function targetHref(targetType: string, targetId: string) {
  if (targetType === 'RESOURCE') return `/resources/${targetId}`;
  if (targetType === 'MARKETPLACE_ITEM') return `/marketplace/${targetId}`;
  if (targetType === 'JOB_POST') return `/campus-work/${targetId}`;
  return '#';
}

export default async function ReportsPage() {
  const queue = await loadReports();
  return (
    <section>
      <header className="admin-masthead">
        <p className="eyebrow">Severity, then age</p>
        <h2>Reports queue</h2>
        <p>
          Internal evidence stays here; reporters receive only a neutral
          outcome.
        </p>
      </header>
      {queue.error ? (
        <div className="empty-state error-state">
          <h2>Reports unavailable</h2>
        </div>
      ) : queue.items.length === 0 ? (
        <div className="empty-state">
          <h2>No open reports.</h2>
        </div>
      ) : (
        <div className="admin-card-grid">
          {queue.items.map((report) => (
            <article className="admin-report-card" key={String(report.id)}>
              <div>
                <span className="status">{String(report.reason)}</span>
                <span>{String(report.status)}</span>
              </div>
              <h3>
                {String(report.targetType)} · {String(report.targetId)}
              </h3>
              <p>
                {String(report.details ?? 'No additional reporter details.')}
              </p>
              <Link
                href={targetHref(
                  String(report.targetType),
                  String(report.targetId),
                )}
                rel="noreferrer"
                target="_blank"
              >
                Open target details
              </Link>
              <small>
                Received {new Date(String(report.createdAt)).toLocaleString()}
              </small>
              <ol aria-label="Prior moderation history" className="audit-list">
                {((report.history ?? []) as Array<Record<string, unknown>>).map(
                  (entry) => (
                    <li key={String(entry.id)}>
                      <time>
                        {new Date(String(entry.createdAt)).toLocaleString()}
                      </time>
                      <strong>{String(entry.action)}</strong>
                      <span>{String(entry.subjectType)}</span>
                      <p>{String(entry.reason)}</p>
                    </li>
                  ),
                )}
              </ol>
              <ReportActionForm
                reportId={String(report.id)}
                status={String(report.status) as 'OPEN' | 'TRIAGED'}
              />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
