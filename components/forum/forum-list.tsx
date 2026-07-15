import Link from 'next/link';

import { buildForumHref, ForumTabs, type ForumView } from './forum-tabs';

export interface ForumListItem {
  _count: { comments: number; likes: number };
  author?: { id: string; name: string | null };
  body: string;
  category: string;
  createdAt: Date;
  id: string;
  publicCode?: string;
  title: string;
}

export function ForumList({
  categories,
  error,
  items,
  page,
  pageSize,
  query,
  total,
  view,
}: {
  categories: Array<{ label: string; slug: string }>;
  error?: string;
  items: ForumListItem[];
  page: number;
  pageSize: number;
  query: { category?: string; query?: string };
  total: number;
  view: ForumView;
}) {
  const current = { ...query, view };
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <main className="page-shell forum-shell">
      <header className="forum-masthead">
        <div>
          <p className="eyebrow">校园论坛 / 04</p>
          <h1>{view === 'tree-hole' ? '匿名树洞' : '校园论坛'}</h1>
          <p>
            {view === 'tree-hole'
              ? '匿名发布，仅开放点赞与举报，不提供评论。'
              : '公开讨论校园生活、学习经验与互助信息。'}
          </p>
        </div>
        <Link
          className="primary-link"
          href={view === 'tree-hole' ? '/submit/tree-hole' : '/submit/forum'}
        >
          {view === 'tree-hole' ? '发布树洞' : '发布讨论'}
        </Link>
      </header>
      <ForumTabs current={current} view={view} />
      <form action="/forum" className="forum-filter" method="get">
        <input name="view" type="hidden" value={view} />
        <label>
          搜索帖子
          <input
            defaultValue={query.query}
            maxLength={100}
            name="query"
            placeholder="输入标题或正文关键词"
          />
        </label>
        <label>
          分类
          <select defaultValue={query.category ?? ''} name="category">
            <option value="">全部分类</option>
            {categories.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">筛选</button>
      </form>
      <p className="forum-result-count" role="status">
        共 {total} 条帖子
      </p>
      {error ? (
        <p className="notice error-state" role="alert">
          {error}
        </p>
      ) : null}
      {!error && items.length === 0 ? (
        <section className="empty-state">
          <h2>没有找到符合条件的帖子</h2>
          <p>换一个关键词或分类再试。</p>
        </section>
      ) : (
        <section aria-label="论坛帖子" className="forum-list">
          {items.map((item) => (
            <article className="forum-list-row" key={item.id}>
              <div className="forum-list-copy">
                <p className="forum-row-meta">
                  <span>
                    {categories.find((entry) => entry.slug === item.category)
                      ?.label ?? item.category}
                  </span>
                  <span>
                    {view === 'tree-hole'
                      ? `树洞 ${item.publicCode ?? ''}`
                      : (item.author?.name ?? '校园同学')}
                  </span>
                  <time dateTime={item.createdAt.toISOString()}>
                    {item.createdAt.toLocaleDateString('zh-CN')}
                  </time>
                </p>
                <h2>
                  <Link href={`/forum/${item.id}?view=${view}`}>
                    {item.title}
                  </Link>
                </h2>
                <p>{item.body}</p>
              </div>
              <dl className="forum-counts">
                {view === 'discussion' ? (
                  <div>
                    <dt>评论</dt>
                    <dd>{item._count.comments}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>点赞</dt>
                  <dd>{item._count.likes}</dd>
                </div>
              </dl>
            </article>
          ))}
        </section>
      )}
      <nav aria-label="论坛分页" className="pagination">
        {page > 1 ? (
          <Link href={buildForumHref(current, { page: page - 1 })}>上一页</Link>
        ) : (
          <span />
        )}
        <span>
          第 {page} / {pages} 页
        </span>
        {page < pages ? (
          <Link href={buildForumHref(current, { page: page + 1 })}>下一页</Link>
        ) : null}
      </nav>
    </main>
  );
}
