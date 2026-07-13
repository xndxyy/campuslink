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
          <h1>
            让知识、物品与互助，<em>在校园里持续流动。</em>
          </h1>
          <p>
            CampusLink
            是面向西大学子的校园公共空间。公开内容经过审核，匿名树洞也为表达保留边界。
          </p>
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
        {announcement ? (
          <Link
            className="hero-announcement"
            href={`/announcements?announcement=${announcement.id}`}
          >
            <span>{announcement.isPinned ? '置顶公告' : '最新公告'}</span>
            <strong>{announcement.title}</strong>
            <time dateTime={announcement.publishedAt.toISOString()}>
              {announcement.publishedAt.toLocaleDateString('zh-CN')}
            </time>
          </Link>
        ) : (
          <div className="hero-announcement hero-announcement-empty">
            <span>校园公告</span>
            <strong>
              {announcementUnavailable ? '公告暂时无法加载' : '目前没有新公告'}
            </strong>
            <Link href="/announcements">查看公告中心</Link>
          </div>
        )}
      </section>
      <CategoryStrip />
    </main>
  );
}
