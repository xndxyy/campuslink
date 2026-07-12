import { notFound } from 'next/navigation';

import { UserActionForm } from '@/components/admin/user-action-form';
import { requireRole } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import {
  listManagedUsers,
  type AdministrationAdapter,
} from '@/lib/domain/administration';

export default async function UsersPage() {
  let users: Record<string, unknown>[];
  try {
    const user = await requireRole(['ADMIN']);
    users = await listManagedUsers(
      getDb() as unknown as AdministrationAdapter,
      { campusId: user.campusId, id: user.id, role: user.role },
    );
  } catch {
    notFound();
  }
  return (
    <section>
      <header className="admin-masthead">
        <p className="eyebrow">Administrator only</p>
        <h2>Campus users</h2>
        <p>
          Privilege and suspension changes are reasoned, audited, and revoke
          affected sessions.
        </p>
      </header>
      {users.length === 0 ? (
        <div className="empty-state">
          <h2>No users match this view.</h2>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Verified</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={String(user.id)}>
                  <td data-label="User">
                    <strong>{String(user.name ?? 'Unnamed member')}</strong>
                    <small>{String(user.email)}</small>
                  </td>
                  <td data-label="Role">{String(user.role)}</td>
                  <td data-label="Status">{String(user.status)}</td>
                  <td data-label="Verified">
                    {user.emailVerifiedAt ? 'Yes' : 'No'}
                  </td>
                  <td data-label="Action">
                    <UserActionForm
                      currentRole={String(user.role)}
                      currentStatus={String(user.status)}
                      userId={String(user.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
