import Link from 'next/link';

import type { ContentRecord } from '@/lib/domain/content-service';
import type { PublicContentKind } from '@/lib/domain/public-content';

const labels = {
  job: { eyebrow: '机会公示', title: '校园工作' },
  marketplace: { eyebrow: '循环市集', title: '二手交换' },
  resource: { eyebrow: '知识共享', title: '学习资源' },
};

function description(item: ContentRecord) {
  const value = item.summary ?? item.description;
  return typeof value === 'string' ? value : '';
}

function meta(kind: PublicContentKind, item: ContentRecord) {
  if (kind === 'resource') return String(item.courseCode ?? '跨学科');
  if (kind === 'marketplace') {
    return `¥${(Number(item.priceCents ?? 0) / 100).toFixed(2)} · ${String(item.condition ?? '')}`;
  }
  return `${String(item.company ?? '')} · ${String(item.location ?? '')}`;
}

export function PublicList({
  error,
  items,
  kind,
  page,
  total,
}: {
  error?: string;
  items: ContentRecord[];
  kind: PublicContentKind;
  page: number;
  total: number;
}) {
  const copy = labels[kind];
  return (
    <main className="page-shell">
      <header className="section-masthead">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
        </div>
        <form className="search-form">
          <label htmlFor="search">检索公告板</label>
          <div>
            <input id="search" name="search" placeholder="标题或正文关键词" />
            <button type="submit">查找</button>
          </div>
        </form>
      </header>

      {error ? <p className="notice error-state">{error}</p> : null}
      {!error && items.length === 0 ? (
        <section className="empty-state">
          <p className="eyebrow">暂无公示</p>
          <h2>这一栏还在等待第一份通过审核的内容。</h2>
          <Link href={`/submit/${kind === 'job' ? 'job' : kind}`}>
            提交内容
          </Link>
        </section>
      ) : null}

      <section className="editorial-list" aria-label={`${copy.title}列表`}>
        {items.map((item, index) => (
          <article className="notice-card" key={item.id}>
            <span className="issue-number">
              {String((page - 1) * 12 + index + 1).padStart(2, '0')}
            </span>
            <div>
              <p className="card-meta">{meta(kind, item)}</p>
              <h2>
                <Link
                  href={`/${kind === 'job' ? 'jobs' : kind === 'resource' ? 'resources' : 'marketplace'}/${item.id}`}
                >
                  {String(item.title)}
                </Link>
              </h2>
              <p>{description(item)}</p>
            </div>
            <time
              dateTime={
                item.createdAt instanceof Date
                  ? item.createdAt.toISOString()
                  : undefined
              }
            >
              {item.createdAt instanceof Date
                ? new Intl.DateTimeFormat('zh-CN').format(item.createdAt)
                : '近期'}
            </time>
          </article>
        ))}
      </section>
      <p className="result-count">
        第 {page} 页 · 共 {total} 条已审核内容
      </p>
    </main>
  );
}
