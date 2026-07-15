import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const adminPage = source('../../app/admin/announcements/page.tsx');
const adminLayout = source('../../app/admin/layout.tsx');
const form = source('../../components/admin/announcement-form.tsx');
const actions = source('../../components/admin/announcement-actions.tsx');
const home = source('../../app/page.tsx');
const publicPage = source('../../app/announcements/page.tsx');
const center = source('../../components/announcements/announcement-center.tsx');
const drawer = source('../../components/announcements/announcement-drawer.tsx');
const uploader = source('../../components/uploads/file-uploader.tsx');
const styles = source('../../app/globals.css');
const e2e = source('../../tests/e2e/announcements.spec.ts');

describe('announcement administration UI contract', () => {
  it('renders an ADMIN-only, campus-scoped management page with real data', () => {
    expect(adminPage).toContain("requireRole(['ADMIN'])");
    expect(adminPage).toContain('listAdminAnnouncements');
    expect(adminPage).toContain('<AnnouncementForm />');
    expect(adminPage).toContain('<AnnouncementActions');
    expect(adminPage).toContain('公告管理');
    expect(adminPage).not.toContain('author.email');
    expect(adminLayout).toContain("user.role === 'ADMIN'");
    expect(adminLayout).toContain('href="/admin/announcements"');
    expect(adminLayout).toContain('公告管理');
  });

  it('uploads an optional announcement cover and posts only approved fields', () => {
    expect(form).toContain('kind="ANNOUNCEMENT_IMAGE"');
    expect(form).toContain("fetch('/api/admin/announcements'");
    expect(form).toContain("method: 'POST'");
    expect(form).toContain('coverAssetId');
    expect(form).toContain('isPinned');
    expect(form).toContain('router.refresh()');
    expect(form).toContain('aria-live="polite"');
    expect(form).not.toContain('campusId');
    expect(form).not.toContain('authorId');
    expect(uploader).toContain("ANNOUNCEMENT_IMAGE: '公告封面图'");
    expect(uploader).toContain('onSelectionStart?: () => void');
    expect(uploader).toContain('onActiveChange?: (active: boolean) => void');
    expect(uploader).toContain('beginUploadAttempt');
    expect(uploader).toContain('transitionUploadAttempt');
    expect(uploader).toContain('finishUploadAttempt');
    expect(uploader).toContain('isCurrentUploadAttempt');
    expect(form).toContain('onSelectionStart={coverSelectionStart}');
    expect(form).toContain('onActiveChange={setUploadActive}');
    expect(form).toContain('pending || uploadActive');
    expect(form).toContain('if (pending || uploadActive)');
    expect(form).toContain('setCoverAssetId(null)');
  });

  it('uses a native two-step irreversible deletion dialog', () => {
    expect(actions).toContain('<dialog');
    expect(actions).toContain('永久删除');
    expect(actions).toContain('确认永久删除');
    expect(actions).toContain('不可恢复');
    expect(actions).toContain("method: 'DELETE'");
    expect(actions).toContain("fetch('/api/admin/announcements'");
    expect(actions).toContain('router.refresh()');
  });
});

describe('public announcement UI contract', () => {
  it('replaces the Hero slogan with one safely queried announcement card', () => {
    expect(home).toContain('getHomeAnnouncement');
    expect(home).toContain('className="hero-announcement-card"');
    expect(home).toContain(
      'className="hero-announcement-card hero-announcement-card-empty"',
    );
    expect(home).toContain(
      'href={`/announcements?announcement=${announcement.id}`}',
    );
    expect(home.indexOf('className="hero-announcement-card"')).toBeGreaterThan(
      home.indexOf('className="hero-copy"'),
    );
    expect(home.indexOf('className="hero-announcement-card"')).toBeLessThan(
      home.indexOf('CampusLink'),
    );
    expect(home).not.toContain('让知识、物品与互助');
    expect(home).not.toContain('className="hero-announcement"');
    expect(styles).toContain('.hero-announcement-card');
    expect(styles).not.toMatch(/\.hero-announcement\s*\{/);
    expect(home).not.toContain('recent-section');
    expect(home).not.toContain('刚刚贴上公告板');
    expect(e2e).toContain("page.locator('.category-strip')");
    expect(e2e).toContain('toBeInViewport');
  });

  it('uses the query parameter as the selected announcement source of truth', () => {
    expect(publicPage).toContain('searchParams: Promise<');
    expect(publicPage).toContain('params.announcement');
    expect(publicPage).toContain('listPublicAnnouncements');
    expect(publicPage).toContain('getPublicAnnouncement');
    expect(publicPage).toContain('<AnnouncementCenter');
    expect(center).toContain('href={`?announcement=${announcement.id}`}');
    expect(center).toContain('<AnnouncementDrawer');
    expect(drawer).toContain('href="/announcements"');
    expect(drawer).toContain('<dialog');
    expect(drawer).toContain('showModal()');
    expect(drawer).toContain("router.replace('/announcements'");
    expect(drawer).not.toContain("router.push('/announcements'");
    expect(drawer).toMatch(
      /<Link[\s\S]*?href="\/announcements"[\s\S]*?replace/,
    );
  });

  it('renders protected matching covers, a brand fallback, and plain text only', () => {
    expect(drawer).toContain("from 'next/image'");
    expect(drawer).toContain('`/api/assets/${announcement.coverAssetId}/read`');
    expect(drawer).toContain("'/brand/campuslink-mark-light.png'");
    expect(drawer).toContain(
      'unoptimized={Boolean(announcement.coverAssetId)}',
    );
    expect(drawer).not.toContain('announcement.cover.');
    expect(drawer).toContain('announcement.body');
    expect(drawer).not.toContain('dangerouslySetInnerHTML');
    expect(center).not.toContain('dangerouslySetInnerHTML');
  });

  it('defines a right-side desktop drawer and full-screen mobile panel', () => {
    expect(styles).toMatch(
      /\.announcement-drawer\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?right:\s*0;/,
    );
    const mobile = styles.slice(styles.indexOf('@media (max-width: 760px)'));
    expect(mobile).toMatch(
      /\.announcement-drawer\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*none;/,
    );
    expect(styles).toContain('.announcement-body');
    expect(styles).toContain('white-space: pre-wrap;');
  });
});
