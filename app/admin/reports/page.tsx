import Link from 'next/link';

import { ReportActionForm } from '@/components/admin/report-action-form';
import { requireRole } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import {
  listModerationReports,
  type ModerationAdapter,
} from '@/lib/domain/moderation';

const reasonLabels: Record<string, string> = {
  HARASSMENT: '骚扰行为',
  MISLEADING: '虚假或误导信息',
  OTHER: '其他',
  PROHIBITED: '违规内容',
  SPAM: '垃圾信息',
};
const statusLabels: Record<string, string> = {
  OPEN: '待处理',
  TRIAGED: '处理中',
};
const targetLabels: Record<string, string> = {
  FORUM_COMMENT: '论坛评论',
  FORUM_POST: '论坛帖子',
  JOB_POST: '校园工作',
  MARKETPLACE_ITEM: '二手物品',
  RESOURCE: '学习资源',
};

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
        <p className="eyebrow">按严重程度和时间排序</p>
        <h2>举报队列</h2>
        <p>证据仅供内部审核；举报人只会收到中立的处理结果。</p>
      </header>
      {queue.error ? (
        <div className="empty-state error-state">
          <h2>举报队列暂时不可用</h2>
        </div>
      ) : queue.items.length === 0 ? (
        <div className="empty-state">
          <h2>当前没有待处理举报</h2>
        </div>
      ) : (
        <div className="admin-card-grid">
          {queue.items.map((report) => (
            <article className="admin-report-card" key={String(report.id)}>
              <div>
                <span className="status">
                  {reasonLabels[String(report.reason)] ?? String(report.reason)}
                </span>
                <span>
                  {statusLabels[String(report.status)] ?? String(report.status)}
                </span>
              </div>
              <h3>
                {targetLabels[String(report.targetType)] ??
                  String(report.targetType)}{' '}
                · {String(report.targetId)}
              </h3>
              <p>{String(report.details ?? '举报人未提供补充说明。')}</p>
              <Link
                href={targetHref(
                  String(report.targetType),
                  String(report.targetId),
                )}
                rel="noreferrer"
                target="_blank"
              >
                查看被举报内容
              </Link>
              <small>
                收到时间：{new Date(String(report.createdAt)).toLocaleString()}
              </small>
              <ol aria-label="历史审核记录" className="audit-list">
                {((report.history ?? []) as Array<Record<string, unknown>>).map(
                  (entry) => (
                    <li key={String(entry.id)}>
                      <time>
                        {new Date(String(entry.createdAt)).toLocaleString()}
                      </time>
                      <strong>{String(entry.action)}</strong>
                      <span>
                        {targetLabels[String(entry.subjectType)] ??
                          String(entry.subjectType)}
                      </span>
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
