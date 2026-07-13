'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { UserActionForm } from './user-action-form';
import {
  accountStatusLabel,
  auditActionLabel,
  auditDetailRows,
  contentStatusLabel,
  reportReasonLabel,
  reportStatusLabel,
  reportTargetTypeLabel,
  roleLabel,
} from './user-detail-labels';
import type {
  ManagedUserDetail,
  ManagedUserDetailTab,
} from '@/lib/domain/administration';

const tabs: { id: ManagedUserDetailTab; label: string }[] = [
  { id: 'overview', label: '账号概览' },
  { id: 'submissions', label: '发布内容' },
  { id: 'reports', label: '举报记录' },
  { id: 'audit', label: '审计记录' },
];

function formatDate(value: unknown) {
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? '时间未知'
    : date.toLocaleString('zh-CN');
}

function RecentContent({
  label,
  records,
  total,
}: {
  label: string;
  records: Record<string, unknown>[];
  total: number;
}) {
  return (
    <section className="admin-user-detail-section">
      <header>
        <h3>{label}</h3>
        <span>共 {total} 条</span>
      </header>
      {records.length === 0 ? (
        <p className="empty-state">暂无记录</p>
      ) : (
        <ol className="admin-user-detail-list">
          {records.map((record) => (
            <li key={String(record.id)}>
              <strong>{String(record.title)}</strong>
              <span>{contentStatusLabel(String(record.status))}</span>
              <time>{formatDate(record.createdAt)}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function UserDetailDrawer({
  activeTab,
  closeHref,
  detail,
  tabHrefs,
}: {
  activeTab: ManagedUserDetailTab;
  closeHref: string;
  detail: ManagedUserDetail;
  tabHrefs: Record<ManagedUserDetailTab, string>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const router = useRouter();
  const overview = detail.overview;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    headingRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [overview.id]);

  return (
    <dialog
      aria-labelledby="managed-user-detail-title"
      className="admin-user-drawer"
      onCancel={(event) => {
        event.preventDefault();
        router.replace(closeHref, { scroll: false });
      }}
      ref={dialogRef}
    >
      <header className="admin-user-drawer-header">
        <div>
          <p className="eyebrow">用户治理详情</p>
          <h2 id="managed-user-detail-title" ref={headingRef} tabIndex={-1}>
            {String(overview.name ?? '未填写姓名')}
          </h2>
          <p>{String(overview.email)}</p>
        </div>
        <Link aria-label="关闭用户详情" href={closeHref} replace>
          关闭
        </Link>
      </header>
      <nav aria-label="用户详情分类" className="admin-user-tabs">
        {tabs.map((tab) => (
          <Link
            aria-current={activeTab === tab.id ? 'page' : undefined}
            href={tabHrefs[tab.id]}
            key={tab.id}
            replace
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className="admin-user-drawer-body">
        {activeTab === 'overview' ? (
          <div className="admin-user-overview">
            <dl>
              <div>
                <dt>角色</dt>
                <dd>{roleLabel(String(overview.role))}</dd>
              </div>
              <div>
                <dt>账号状态</dt>
                <dd>{accountStatusLabel(String(overview.status))}</dd>
              </div>
              <div>
                <dt>邮箱验证</dt>
                <dd>{overview.emailVerifiedAt ? '已验证' : '未验证'}</dd>
              </div>
              <div>
                <dt>活跃会话</dt>
                <dd>{String(overview.activeSessionCount)}</dd>
              </div>
              <div>
                <dt>加入时间</dt>
                <dd>{formatDate(overview.createdAt)}</dd>
              </div>
            </dl>
            <UserActionForm
              currentRole={String(overview.role)}
              currentStatus={String(overview.status)}
              emailVerified={Boolean(overview.emailVerifiedAt)}
              userId={String(overview.id)}
            />
          </div>
        ) : null}
        {activeTab === 'submissions' ? (
          <div className="admin-user-submissions">
            <RecentContent
              label="学习资源"
              records={detail.submissions.resources.recent}
              total={detail.submissions.resources.total}
            />
            <RecentContent
              label="二手物品"
              records={detail.submissions.marketplaceItems.recent}
              total={detail.submissions.marketplaceItems.total}
            />
            <RecentContent
              label="校园工作"
              records={detail.submissions.jobPosts.recent}
              total={detail.submissions.jobPosts.total}
            />
          </div>
        ) : null}
        {activeTab === 'reports' ? (
          <section className="admin-user-detail-section">
            <header>
              <h3>该用户提交的举报</h3>
              <span>共 {detail.reports.submittedCount} 条</span>
            </header>
            <p className="admin-user-detail-note">
              此处仅汇总该用户在本校提交的举报，不代表针对该用户的举报。
            </p>
            {detail.reports.recent.length === 0 ? (
              <p className="empty-state">暂无举报记录</p>
            ) : (
              <ol className="admin-user-detail-list">
                {detail.reports.recent.map((report) => (
                  <li key={String(report.id)}>
                    <strong>
                      {reportTargetTypeLabel(String(report.targetType))} ·{' '}
                      {reportReasonLabel(String(report.reason))}
                    </strong>
                    <span>{reportStatusLabel(String(report.status))}</span>
                    <time>{formatDate(report.createdAt)}</time>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ) : null}
        {activeTab === 'audit' ? (
          <section className="admin-user-detail-section">
            <header>
              <h3>账号治理与处罚历史</h3>
            </header>
            {detail.audit.recent.length === 0 ? (
              <p className="empty-state">暂无审计记录</p>
            ) : (
              <ol className="admin-user-audit-list">
                {detail.audit.recent.map((entry) => {
                  const detailRows = auditDetailRows(entry.details);
                  return (
                    <li key={String(entry.id)}>
                      <time>{formatDate(entry.createdAt)}</time>
                      <strong>{auditActionLabel(String(entry.action))}</strong>
                      {detailRows.length === 0 ? (
                        <p>无补充信息</p>
                      ) : (
                        <dl className="admin-user-audit-details">
                          {detailRows.map((row, index) => (
                            <div key={`${row.label}-${index}`}>
                              <dt>{row.label}</dt>
                              <dd>{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        ) : null}
      </div>
    </dialog>
  );
}
