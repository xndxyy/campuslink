import Link from 'next/link';
import { getDb } from '@/lib/db';

type Recent = {
  id: string;
  title: string;
  type: 'resources' | 'marketplace' | 'jobs';
};

async function recentContent(): Promise<{ error?: string; items: Recent[] }> {
  try {
    const db = getDb();
    const [resources, marketplace, jobs] = await Promise.all([
      db.resource.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, title: true },
        take: 3,
        where: { status: 'PUBLISHED' },
      }),
      db.marketplaceItem.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, title: true },
        take: 3,
        where: { status: 'PUBLISHED' },
      }),
      db.jobPost.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, title: true },
        take: 3,
        where: { status: 'PUBLISHED' },
      }),
    ]);
    return {
      items: [
        ...resources.map((item) => ({ ...item, type: 'resources' as const })),
        ...marketplace.map((item) => ({
          ...item,
          type: 'marketplace' as const,
        })),
        ...jobs.map((item) => ({ ...item, type: 'jobs' as const })),
      ].slice(0, 6),
    };
  } catch {
    return {
      error: '实时公告暂时不可用；数据库连接恢复后会自动显示。',
      items: [],
    };
  }
}

export default async function HomePage() {
  const recent = await recentContent();
  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">校内可信公告板 · 2026</p>
          <h1>
            把知识、物品与机会，<em>留在校园里流动。</em>
          </h1>
          <p>
            CampusLink 是经审核的校园公共空间。真实身份发布，公开内容先审后见。
          </p>
          <div className="hero-actions">
            <Link href="/resources">浏览最新内容</Link>
            <Link href="/submit/resource">发起一份共享</Link>
          </div>
        </div>
        <aside>
          <span>今日栏目</span>
          <strong>03</strong>
          <p>
            学习资源
            <br />
            循环市集
            <br />
            校园工作
          </p>
        </aside>
      </section>
      <section className="category-strip">
        <Link href="/resources">
          <b>01</b>
          <span>知识共享</span>
          <small>笔记 · 讲义 · 课程资料</small>
        </Link>
        <Link href="/marketplace">
          <b>02</b>
          <span>循环市集</span>
          <small>书籍 · 设备 · 生活用品</small>
        </Link>
        <Link href="/jobs">
          <b>03</b>
          <span>机会公示</span>
          <small>兼职 · 实习 · 校内岗位</small>
        </Link>
      </section>
      <section className="recent-section">
        <header>
          <p className="eyebrow">经过审核 / RECENT</p>
          <h2>刚刚贴上公告板</h2>
        </header>
        {recent.error ? <p className="notice">{recent.error}</p> : null}
        <div className="recent-grid">
          {recent.items.map((item) => (
            <Link
              href={`/${item.type}/${item.id}`}
              key={`${item.type}-${item.id}`}
            >
              <span>
                {item.type === 'resources'
                  ? '知识'
                  : item.type === 'marketplace'
                    ? '市集'
                    : '机会'}
              </span>
              <strong>{item.title}</strong>
              <i>阅读全文 →</i>
            </Link>
          ))}
        </div>
        {!recent.error && recent.items.length === 0 ? (
          <p className="notice">暂无通过审核的内容。成为第一位认真分享的人。</p>
        ) : null}
      </section>
    </main>
  );
}
