import { notFound } from 'next/navigation';

import { AnnouncementActions } from '@/components/admin/announcement-actions';
import { AnnouncementForm } from '@/components/admin/announcement-form';
import { requireRole } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import {
  listAdminAnnouncements,
  type AnnouncementQueryAdapter,
  type AnnouncementSummary,
} from '@/lib/domain/announcement-queries';

export default async function AnnouncementsAdminPage() {
  let actor;
  try {
    const user = await requireRole(['ADMIN']);
    actor = { campusId: user.campusId, id: user.id, role: user.role };
  } catch {
    notFound();
  }

  let announcements: AnnouncementSummary[] = [];
  let unavailable = false;
  try {
    announcements = await listAdminAnnouncements(
      getDb() as unknown as AnnouncementQueryAdapter,
      actor,
    );
  } catch {
    unavailable = true;
  }

  return (
    <section>
      <header className="admin-masthead">
        <p className="eyebrow">仅管理员可用</p>
        <h2>公告管理</h2>
        <p>发布全站公告、设置当前置顶内容，并通过二次确认永久删除历史公告。</p>
      </header>
      <div className="announcement-admin-layout">
        <section aria-labelledby="publish-announcement-heading">
          <h3 id="publish-announcement-heading">发布新公告</h3>
          <AnnouncementForm />
        </section>
        <section aria-labelledby="published-announcements-heading">
          <h3 id="published-announcements-heading">已发布公告</h3>
          {unavailable ? (
            <div className="empty-state error-state">
              <h2>公告列表暂时不可用</h2>
              <p>请检查数据库连接后重试。</p>
            </div>
          ) : announcements.length === 0 ? (
            <div className="empty-state">
              <h2>还没有公告</h2>
              <p>发布后的公告会立即出现在这里和公告中心。</p>
            </div>
          ) : (
            <div className="announcement-admin-list">
              {announcements.map((announcement) => (
                <article
                  className="announcement-admin-row"
                  key={announcement.id}
                >
                  <div>
                    <p className="announcement-row-meta">
                      {announcement.isPinned ? '置顶公告' : '历史公告'} ·{' '}
                      <time dateTime={announcement.publishedAt.toISOString()}>
                        {announcement.publishedAt.toLocaleDateString('zh-CN')}
                      </time>
                    </p>
                    <h4>{announcement.title}</h4>
                    <small>
                      {announcement.cover ? '含封面图' : '品牌默认封面'}
                    </small>
                  </div>
                  <AnnouncementActions
                    announcementId={announcement.id}
                    title={announcement.title}
                  />
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
