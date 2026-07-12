import { ModerationActionForm } from '@/components/admin/moderation-action-form';
import { requireRole } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import {
  listPendingContent,
  type ModerationAdapter,
} from '@/lib/domain/moderation';

async function loadQueue() {
  try {
    const user = await requireRole(['MODERATOR', 'ADMIN']);
    return {
      error: false,
      items: await listPendingContent(getDb() as unknown as ModerationAdapter, {
        campusId: user.campusId,
        id: user.id,
        role: user.role,
      }),
    };
  } catch {
    return { error: true, items: [] };
  }
}

export default async function ModerationPage() {
  const queue = await loadQueue();
  return (
    <section>
      <header className="admin-masthead">
        <p className="eyebrow">Oldest first · ready assets only</p>
        <h2>Pending publication</h2>
        <p>
          Every decision updates content and writes immutable moderation and
          audit records in one transaction.
        </p>
      </header>
      {queue.error ? (
        <div className="empty-state error-state">
          <h2>Review queue unavailable</h2>
          <p>Retry after checking the database connection.</p>
        </div>
      ) : queue.items.length === 0 ? (
        <div className="empty-state">
          <h2>No submissions are waiting.</h2>
          <p>The queue is clear.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Submission</th>
                <th>Author</th>
                <th>Received</th>
                <th>Assets</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {queue.items.map((item) => {
                const record = item as Record<string, unknown> & {
                  subjectType: 'RESOURCE' | 'MARKETPLACE_ITEM' | 'JOB_POST';
                };
                const author = (record.author ?? record.seller) as
                  { name?: string | null } | undefined;
                const assets = (record.assets ?? []) as Array<
                  Record<string, unknown>
                >;
                return (
                  <tr key={`${record.subjectType}-${record.id}`}>
                    <td data-label="Submission">
                      <span className="status">{record.subjectType}</span>
                      <strong>{String(record.title)}</strong>
                      <small>
                        {String(
                          record.summary ??
                            record.description ??
                            record.company ??
                            '',
                        )}
                      </small>
                    </td>
                    <td data-label="Author">
                      {author?.name ?? 'Unnamed member'}
                    </td>
                    <td data-label="Received">
                      <time
                        dateTime={new Date(
                          String(record.createdAt),
                        ).toISOString()}
                      >
                        {new Date(
                          String(record.createdAt),
                        ).toLocaleDateString()}
                      </time>
                    </td>
                    <td data-label="Assets">{assets.length}</td>
                    <td data-label="Decision" className="admin-actions-cell">
                      <ModerationActionForm
                        action="APPROVE"
                        label="Approve"
                        subjectId={String(record.id)}
                        subjectType={record.subjectType}
                      />
                      <ModerationActionForm
                        action="REJECT"
                        label="Reject"
                        subjectId={String(record.id)}
                        subjectType={record.subjectType}
                      />
                      <ModerationActionForm
                        action="ARCHIVE"
                        label="Archive"
                        subjectId={String(record.id)}
                        subjectType={record.subjectType}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
