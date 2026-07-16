import Link from 'next/link';

import { ModerationActionForm } from '@/components/admin/moderation-action-form';
import { requireRole } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import {
  listModerationContent,
  type ContentSubjectType,
  type ModerationAdapter,
  type ModerationContentStatus,
} from '@/lib/domain/moderation';

const statuses: ModerationContentStatus[] = [
  'PENDING',
  'PUBLISHED',
  'REJECTED',
  'HIDDEN',
];

const statusLabels: Record<ModerationContentStatus, string> = {
  HIDDEN: '已隐藏',
  PENDING: '待人工审核',
  PUBLISHED: '已发布',
  REJECTED: '已拒绝',
};

const subjectLabels: Record<ContentSubjectType, string> = {
  FORUM_COMMENT: '论坛评论',
  FORUM_POST: '论坛 / 树洞',
  JOB_POST: '校园工作',
  MARKETPLACE_ITEM: '二手交易',
  RESOURCE: '学习资源',
};

async function loadQueue(
  status: ModerationContentStatus,
  providerStatus?: 'SKIPPED',
) {
  try {
    const user = await requireRole(['MODERATOR', 'ADMIN']);
    return {
      error: false,
      items: await listModerationContent(
        getDb() as unknown as ModerationAdapter,
        { campusId: user.campusId, id: user.id, role: user.role },
        { providerStatus, status },
      ),
    };
  } catch {
    return { error: true, items: [] };
  }
}

export default async function ModerationPage({
  searchParams,
}: {
  searchParams: Promise<{ providerStatus?: string; status?: string }>;
}) {
  const params = await searchParams;
  const status = statuses.includes(params.status as ModerationContentStatus)
    ? (params.status as ModerationContentStatus)
    : 'PENDING';
  const providerStatus =
    params.providerStatus === 'SKIPPED' ? ('SKIPPED' as const) : undefined;
  const queue = await loadQueue(status, providerStatus);
  const hasSkipped = queue.items.some(
    (item) => item.hasSkippedAssessment === true,
  );

  return (
    <section>
      <header className="admin-masthead">
        <p className="eyebrow">本校区内容治理</p>
        <h2>{statusLabels[status]}</h2>
        <p>人工决定、内容状态、AI 评估和审计记录在服务端统一关联。</p>
      </header>

      <nav aria-label="审核状态筛选" className="admin-filter">
        {statuses.map((view) => (
          <Link
            aria-current={
              status === view && !providerStatus ? 'page' : undefined
            }
            href={`/admin/moderation?status=${view}`}
            key={view}
          >
            {statusLabels[view]}
          </Link>
        ))}
        <Link
          aria-current={providerStatus ? 'page' : undefined}
          href="/admin/moderation?status=PUBLISHED&providerStatus=SKIPPED"
        >
          AI 检查已跳过
        </Link>
      </nav>

      {hasSkipped ? (
        <div className="empty-state error-state" role="status">
          <h2>存在未执行 AI 自动评估的内容</h2>
          <p>本地硬性规则已通过，但外部模型未完成评估，请优先人工复核。</p>
        </div>
      ) : null}

      {queue.error ? (
        <div className="empty-state error-state">
          <h2>审核队列暂时不可用</h2>
          <p>请检查数据库连接后重试。</p>
        </div>
      ) : queue.items.length === 0 ? (
        <div className="empty-state">
          <h2>当前筛选下没有内容</h2>
          <p>本校区队列已处理完毕。</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>内容</th>
                <th>作者</th>
                <th>提交时间</th>
                <th>AI 评估</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {queue.items.map((item) => {
                const record = item as Record<string, unknown> & {
                  subjectType: ContentSubjectType;
                };
                const author = (record.author ?? record.seller) as
                  { name?: string | null } | undefined;
                const post = record.post as { title?: string } | undefined;
                const assessment = record.assessment as Record<
                  string,
                  unknown
                > | null;
                const adminSignals = Array.isArray(assessment?.adminSignals)
                  ? assessment.adminSignals.map(String)
                  : [];
                const categories = Array.isArray(assessment?.categories)
                  ? assessment.categories.map(String)
                  : [];
                return (
                  <tr key={`${record.subjectType}-${record.id}`}>
                    <td data-label="内容">
                      <span className="status">
                        {subjectLabels[record.subjectType]}
                      </span>
                      <strong>
                        {String(record.title ?? post?.title ?? '论坛评论')}
                      </strong>
                      <small>
                        {String(
                          record.summary ??
                            record.description ??
                            record.body ??
                            record.company ??
                            '',
                        )}
                      </small>
                    </td>
                    <td data-label="作者">
                      {author?.name ?? '匿名或未命名用户'}
                    </td>
                    <td data-label="提交时间">
                      <time
                        dateTime={new Date(
                          String(record.createdAt),
                        ).toISOString()}
                      >
                        {new Date(String(record.createdAt)).toLocaleString(
                          'zh-CN',
                        )}
                      </time>
                    </td>
                    <td data-label="AI 评估">
                      {assessment ? (
                        <div className="admin-assessment">
                          <strong>
                            {String(assessment.decision)} · 风险分{' '}
                            {assessment.riskScore === null
                              ? '无'
                              : String(assessment.riskScore)}
                          </strong>
                          <small>
                            {String(assessment.providerStatus)}
                            {assessment.model
                              ? ` · ${String(assessment.model)}`
                              : ''}
                          </small>
                          {categories.length ? (
                            <small>{categories.join('、')}</small>
                          ) : null}
                          {assessment.reasonZh ? (
                            <small>原因：{String(assessment.reasonZh)}</small>
                          ) : null}
                          {assessment.suggestionZh ? (
                            <small>
                              建议：{String(assessment.suggestionZh)}
                            </small>
                          ) : null}
                          {adminSignals.length ? (
                            <small>管理员信号：{adminSignals.join('；')}</small>
                          ) : null}
                          {record.hasSkippedAssessment ? (
                            <small>
                              含自定义标签在内的 AI 检查未全部完成，请人工复核。
                            </small>
                          ) : null}
                        </div>
                      ) : (
                        <small>未启用 AI 自动评估</small>
                      )}
                    </td>
                    <td data-label="操作" className="admin-actions-cell">
                      {status === 'PENDING' ? (
                        <>
                          <ModerationActionForm
                            action="APPROVE"
                            label="通过"
                            subjectId={String(record.id)}
                            subjectType={record.subjectType}
                          />
                          <ModerationActionForm
                            action="REJECT"
                            label="拒绝"
                            subjectId={String(record.id)}
                            subjectType={record.subjectType}
                          />
                        </>
                      ) : null}
                      {status === 'PUBLISHED' ? (
                        <ModerationActionForm
                          action="HIDE"
                          label="隐藏"
                          subjectId={String(record.id)}
                          subjectType={record.subjectType}
                        />
                      ) : null}
                      {status === 'HIDDEN' ? (
                        <ModerationActionForm
                          action="RESTORE"
                          label="恢复"
                          subjectId={String(record.id)}
                          subjectType={record.subjectType}
                        />
                      ) : null}
                      {status !== 'REJECTED' ? (
                        <ModerationActionForm
                          action="ARCHIVE"
                          label="归档"
                          subjectId={String(record.id)}
                          subjectType={record.subjectType}
                        />
                      ) : null}
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
