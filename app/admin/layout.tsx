import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireRole } from '@/lib/auth/guards';

const roleLabels = {
  ADMIN: '管理员',
  MODERATOR: '审核员',
  STUDENT: '学生',
} as const;

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
        <p className="eyebrow">校园治理</p>
        <h1>审核工作台</h1>
        <p className="admin-identity">
          {user.name ?? '工作人员'} · {roleLabels[user.role]}
        </p>
        <nav aria-label="管理导航">
          <Link href="/admin/moderation">内容审核</Link>
          <Link href="/admin/reports">举报处理</Link>
          {user.role === 'ADMIN' ? (
            <>
              <Link href="/admin/announcements">公告管理</Link>
              <Link href="/admin/tags">标签管理</Link>
              <Link href="/admin/blocked-words">屏蔽词管理</Link>
              <Link href="/admin/ai-settings">AI 审核设置</Link>
              <Link href="/admin/users">用户管理</Link>
              <Link href="/admin/audit-log">审计日志</Link>
              <Link href="/admin/settings">校区设置</Link>
            </>
          ) : null}
        </nav>
      </aside>
      <main className="admin-workspace">{children}</main>
    </div>
  );
}
