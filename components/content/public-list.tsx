import Link from 'next/link';

import type { ContentRecord } from '@/lib/domain/content-service';
import {
  contentTagsForPresentation,
  type PublicContentKind,
} from '@/lib/domain/public-content';
import type { ContentListQuery } from '@/lib/validation/content';

const labels = {
  'campus-work': { eyebrow: '校园互助', title: '校园工作' },
  marketplace: { eyebrow: '循环市集', title: '二手交换' },
  resource: { eyebrow: '知识共享', title: '学习资源' },
};

function routeFor(kind: PublicContentKind) {
  return kind === 'resource'
    ? '/resources'
    : kind === 'marketplace'
      ? '/marketplace'
      : '/campus-work';
}

export function PublicList({
  error,
  items,
  kind,
  page,
  pageSize,
  query,
  total,
}: {
  error?: string;
  items: ContentRecord[];
  kind: PublicContentKind;
  page: number;
  pageSize: number;
  query: Partial<ContentListQuery>;
  total: number;
}) {
  const copy = labels[kind];
  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== '') params.set(key, String(value));
    });
    params.set('page', String(target));
    params.set('pageSize', String(pageSize));
    return `${routeFor(kind)}?${params}`;
  };
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
            <input
              defaultValue={query.search}
              id="search"
              name="search"
              placeholder="标题或正文关键词"
            />
            <button type="submit">查找</button>
          </div>
          <input name="pageSize" type="hidden" value={pageSize} />
          <div className="filter-row">
            {kind === 'resource' ? (
              <>
                <input
                  defaultValue={query.courseCode}
                  name="courseCode"
                  placeholder="课程代码"
                />
                <input defaultValue={query.tag} name="tag" placeholder="标签" />
              </>
            ) : null}
            {kind === 'marketplace' ? (
              <>
                <select defaultValue={query.condition ?? ''} name="condition">
                  <option value="">全部状态</option>
                  <option value="NEW">全新</option>
                  <option value="LIKE_NEW">近乎全新</option>
                  <option value="GOOD">良好</option>
                  <option value="FAIR">有使用痕迹</option>
                  <option value="POOR">明显磨损</option>
                </select>
                <input defaultValue={query.tag} name="tag" placeholder="标签" />
                <input
                  defaultValue={query.minPriceCents}
                  inputMode="numeric"
                  name="minPriceCents"
                  placeholder="最低价（分）"
                />
                <input
                  defaultValue={query.maxPriceCents}
                  inputMode="numeric"
                  name="maxPriceCents"
                  placeholder="最高价（分）"
                />
              </>
            ) : null}
            {kind === 'campus-work' ? (
              <>
                <input defaultValue={query.tag} name="tag" placeholder="标签" />
                <input
                  defaultValue={query.location}
                  name="location"
                  placeholder="地点"
                />
              </>
            ) : null}
          </div>
        </form>
      </header>
      {error ? <p className="notice error-state">{error}</p> : null}
      {!error && items.length === 0 ? (
        <section className="empty-state">
          <p className="eyebrow">暂无公示</p>
          <h2>这一栏还在等待第一份通过审核的内容。</h2>
          <Link href={`/submit/${kind}`}>提交内容</Link>
        </section>
      ) : null}
      <section className="editorial-list" aria-label={`${copy.title}列表`}>
        {items.map((item, index) => {
          const description = String(item.summary ?? item.description ?? '');
          const tags = contentTagsForPresentation(item);
          const meta =
            kind === 'resource'
              ? String(item.courseCode ?? '跨学科')
              : kind === 'marketplace'
                ? `¥${(Number(item.priceCents ?? 0) / 100).toFixed(2)} · ${String(item.condition ?? '')}`
                : `${String(item.location ?? '')} · ${String(item.payText ?? '')}`;
          return (
            <article className="notice-card" key={item.id}>
              <span className="issue-number">
                {String((page - 1) * pageSize + index + 1).padStart(2, '0')}
              </span>
              <div>
                <p className="card-meta">{meta}</p>
                {tags.length > 0 ? (
                  <ul className="content-tag-list" aria-label="内容标签">
                    {tags.map((tag) => (
                      <li
                        className={tag.isActive ? undefined : 'is-inactive'}
                        key={tag.id}
                        title={tag.isActive ? undefined : '历史标签（已停用）'}
                      >
                        {tag.label}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <h2>
                  <Link href={`${routeFor(kind)}/${item.id}`}>
                    {String(item.title)}
                  </Link>
                </h2>
                <p>{description}</p>
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
          );
        })}
      </section>
      <p className="result-count">
        第 {page} 页 · 共 {total} 条已审核内容
      </p>
      <nav className="pagination" aria-label="分页">
        {page > 1 ? <Link href={pageHref(page - 1)}>← 上一页</Link> : <span />}
        {page * pageSize < total ? (
          <Link href={pageHref(page + 1)}>下一页 →</Link>
        ) : null}
      </nav>
    </main>
  );
}
