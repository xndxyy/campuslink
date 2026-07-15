import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireRole } from '@/lib/auth/guards';

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  let user;
  try {
    user = await requireRole(['MODERATOR', 'ADMIN']);
  } catch {
    notFound();
  }

  return (
    <div className="admin-shell">
      <aside className="admin-rail">
        <p className="eyebrow">Campus governance</p>
        <h1>Review desk</h1>
        <p className="admin-identity">
          {user.name ?? 'Staff member'} · {user.role}
        </p>
        <nav aria-label="Administration">
          <Link href="/admin/moderation">Moderation</Link>
          <Link href="/admin/reports">Reports</Link>
          {user.role === 'ADMIN' ? (
            <>
              <Link href="/admin/announcements">公告管理</Link>
              <Link href="/admin/tags">标签管理</Link>
              <Link href="/admin/blocked-words">屏蔽词管理</Link>
              <Link href="/admin/users">Users</Link>
              <Link href="/admin/audit-log">Audit log</Link>
              <Link href="/admin/settings">Campus settings</Link>
            </>
          ) : null}
        </nav>
      </aside>
      <main className="admin-workspace">{children}</main>
    </div>
  );
}
