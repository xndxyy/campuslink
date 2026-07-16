import Link from 'next/link';

import { AnnouncementDrawer } from './announcement-drawer';
import type { PublicAnnouncement } from '@/lib/domain/announcement-queries';

interface AnnouncementCenterProps {
  announcements: PublicAnnouncement[];
  error?: string;
  selected: PublicAnnouncement | null;
  selectionMissing?: boolean;
}

export function AnnouncementCenter({
  announcements,
  error,
  selected,
  selectionMissing = false,
}: AnnouncementCenterProps) {
  return (
    <main className="announcement-center page-shell">
      <header className="announcement-center-masthead">
        <p className="eyebrow">CampusLink 公告</p>
        <h1>校园公告</h1>
        <p>查看站务更新、校园安全提醒与近期公共信息。</p>
      </header>
      {error ? (
        <div className="empty-state error-state">
          <h2>公告暂时无法加载</h2>
          <p>{error}</p>
        </div>
      ) : announcements.length === 0 ? (
        <div className="empty-state">
          <h2>目前没有公告</h2>
          <p>新的校园公告发布后会显示在这里。</p>
        </div>
      ) : (
        <section aria-labelledby="announcement-history-heading">
          <h2 className="visually-hidden" id="announcement-history-heading">
            公告历史
          </h2>
          {selectionMissing ? (
            <p className="announcement-selection-missing" role="status">
              所选公告不存在或已被删除，以下是当前公告。
            </p>
          ) : null}
          <div className="announcement-history">
            {announcements.map((announcement, index) => (
              <article
                className="announcement-history-row"
                key={announcement.id}
              >
                <span aria-hidden="true" className="announcement-index">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <p className="announcement-row-meta">
                    {announcement.isPinned ? '置顶' : '公告'} ·{' '}
                    <time dateTime={announcement.publishedAt.toISOString()}>
                      {announcement.publishedAt.toLocaleDateString('zh-CN')}
                    </time>
                  </p>
                  <h3>
                    <Link href={`?announcement=${announcement.id}`}>
                      {announcement.title}
                    </Link>
                  </h3>
                  <p>{announcement.body}</p>
                </div>
                <Link
                  aria-label={`查看公告“${announcement.title}”`}
                  className="announcement-open"
                  href={`?announcement=${announcement.id}`}
                >
                  查看
                </Link>
              </article>
            ))}
          </div>
        </section>
      )}
      {selected ? <AnnouncementDrawer announcement={selected} /> : null}
    </main>
  );
}
