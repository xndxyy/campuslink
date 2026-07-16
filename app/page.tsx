import Link from 'next/link';
import { CategoryStrip } from '@/components/home/category-strip';
import { getDb } from '@/lib/db';
import {
  getHomeAnnouncement,
  type AnnouncementQueryAdapter,
  type AnnouncementSummary,
} from '@/lib/domain/announcement-queries';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let announcement: AnnouncementSummary | null = null;
  let announcementUnavailable = false;
  try {
    announcement = await getHomeAnnouncement(
      getDb() as unknown as AnnouncementQueryAdapter,
    );
  } catch {
    announcementUnavailable = true;
  }
  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">西大学生社区 · 2026</p>
          {announcement ? (
            <Link
              className="hero-announcement-card"
              href={`/announcements?announcement=${announcement.id}`}
            >
              <span className="hero-announcement-card-meta">
                <span>{announcement.isPinned ? '置顶公告' : '最新公告'}</span>
                <time dateTime={announcement.publishedAt.toISOString()}>
                  {announcement.publishedAt.toLocaleDateString('zh-CN')}
                </time>
              </span>
              <h1>{announcement.title}</h1>
              <span className="hero-announcement-card-action">查看公告</span>
            </Link>
          ) : (
            <div className="hero-announcement-card hero-announcement-card-empty">
              <span className="hero-announcement-card-meta">
                <span>校园公告</span>
              </span>
              <h1>
                {announcementUnavailable
                  ? '公告暂时无法加载'
                  : '目前没有新公告'}
              </h1>
              <Link
                className="hero-announcement-card-action"
                href="/announcements"
              >
                查看公告中心
              </Link>
            </div>
          )}
          <p>CampusLink 是面向西大学子的校园公共空间。</p>
          <div className="hero-actions">
            <Link href="/resources">浏览校园内容</Link>
            <Link href="/submit">发布内容</Link>
          </div>
        </div>
        <aside>
          <span>今日栏目</span>
          <strong>04</strong>
          <p>
            学习资源
            <br />
            二手交易
            <br />
            校园工作
            <br />
            校园论坛
          </p>
        </aside>
      </section>
      <CategoryStrip />
    </main>
  );
}
