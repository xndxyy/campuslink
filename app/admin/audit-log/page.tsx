import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireRole } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import {
  listAuditLogs,
  parseAuditQuery,
  type AuditAdapter,
} from '@/lib/domain/audit';

type AuditSearchParams = Record<string, string | string[] | undefined>;

const entityLabels: Record<string, string> = {
  ASSET: '文件',
  CAMPUS: '校区',
  JOB_POST: '校园工作',
  MARKETPLACE_ITEM: '二手物品',
  REPORT: '举报',
  RESOURCE: '学习资源',
  SYSTEM: '系统',
  USER: '用户',
};

function toUrlSearchParams(input: AuditSearchParams) {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(key, item);
    } else if (value !== undefined) {
      result.set(key, value);
    }
  }
  return result;
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<AuditSearchParams>;
}) {
  const values = toUrlSearchParams(await searchParams);
  let records: Record<string, unknown>[];
  let nextCursor: string | null;
  try {
    const user = await requireRole(['ADMIN']);
    const result = await listAuditLogs(
      getDb() as unknown as AuditAdapter,
      { campusId: user.campusId, id: user.id, role: user.role },
      parseAuditQuery(values),
    );
    records = result.items;
    nextCursor = result.nextCursor;
  } catch {
    notFound();
  }
  const nextSearchParams = new URLSearchParams(values);
  if (nextCursor) nextSearchParams.set('cursor', nextCursor);
  return (
    <section>
      <header className="admin-masthead">
        <p className="eyebrow">不可变更的校区记录</p>
        <h2>审计日志</h2>
        <p>
          按时间倒序展示稳定记录；密钥、凭据、联系方式和令牌字段会在显示前移除。
        </p>
      </header>
      <form className="admin-filter" method="get">
        <label>
          事件
          <input defaultValue={values.get('event') ?? ''} name="event" />
        </label>
        <label>
          操作者 ID
          <input defaultValue={values.get('actor') ?? ''} name="actor" />
        </label>
        <label>
          对象类型
          <select
            defaultValue={values.get('entityType') ?? ''}
            name="entityType"
          >
            <option value="">全部</option>
            {[
              'CAMPUS',
              'USER',
              'ASSET',
              'RESOURCE',
              'MARKETPLACE_ITEM',
              'JOB_POST',
              'REPORT',
            ].map((type) => (
              <option key={type} value={type}>
                {entityLabels[type] ?? type}
              </option>
            ))}
          </select>
        </label>
        <label>
          对象 ID
          <input defaultValue={values.get('entityId') ?? ''} name="entityId" />
        </label>
        <label>
          开始时间
          <input
            defaultValue={values.get('from') ?? ''}
            name="from"
            type="datetime-local"
          />
        </label>
        <label>
          结束时间
          <input
            defaultValue={values.get('to') ?? ''}
            name="to"
            type="datetime-local"
          />
        </label>
        <label>
          每页数量
          <input
            defaultValue={values.get('pageSize') ?? '50'}
            max={100}
            min={1}
            name="pageSize"
            type="number"
          />
        </label>
        <input name="cursor" type="hidden" value="" />
        <button type="submit">筛选</button>
      </form>
      {records.length === 0 ? (
        <div className="empty-state">
          <h2>没有符合条件的审计记录</h2>
        </div>
      ) : (
        <ol className="audit-list">
          {records.map((record) => (
            <li key={String(record.id)}>
              <time>{new Date(String(record.createdAt)).toLocaleString()}</time>
              <strong>{String(record.action)}</strong>
              <span>
                {entityLabels[String(record.subjectType ?? 'SYSTEM')] ??
                  String(record.subjectType ?? 'SYSTEM')}{' '}
                · {String(record.subjectId ?? '—')}
              </span>
              <pre>{JSON.stringify(record.details ?? {}, null, 2)}</pre>
            </li>
          ))}
        </ol>
      )}
      {nextCursor ? (
        <Link href={`?${nextSearchParams.toString()}`}>下一页</Link>
      ) : null}
    </section>
  );
}
