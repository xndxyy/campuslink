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
              <small>
                Received {new Date(String(report.createdAt)).toLocaleString()}
              </small>
              <ReportActionForm reportId={String(report.id)} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
