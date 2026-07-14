import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const page = source('../../app/admin/tags/page.tsx');
const component = source('../../components/admin/tag-management.tsx');
const layout = source('../../app/admin/layout.tsx');
const styles = source('../../app/globals.css');
const schema = source('../../prisma/schema.prisma');
const audit = source('../../lib/domain/audit.ts');
const migration = source(
  '../../prisma/migrations/20260713191000_add_tag_audit_subject/migration.sql',
);
const originalTagMigration = source(
  '../../prisma/migrations/20260713190000_add_tags_and_campus_work/migration.sql',
);
const manifest = JSON.parse(source('../../package.json')) as {
  dependencies: Record<string, string>;
};
const lockfile = JSON.parse(source('../../package-lock.json')) as {
  packages: Record<string, { license?: string; version?: string }>;
};

describe('Chinese tag governance UI contract', () => {
  it('renders an ADMIN-only page whose scope comes from the URL', () => {
    expect(page).toContain("requireRole(['ADMIN'])");
    expect(page).toContain('searchParams: Promise<');
    expect(page).toContain('params.scope');
    expect(page).toContain('params.pageSize');
    expect(page).toContain('params.cursor');
    expect(page).toContain('parseManagedTagQuery');
    expect(page).toContain('listManagedTags');
    expect(page).toContain('<TagManagement');
    expect(page).toContain('标签管理');
    expect(page).toContain('学习资源');
    expect(page).toContain('二手交易');
    expect(page).toContain('校园工作');
    expect(page).toContain("scopeHref('RESOURCE', pageSize)");
    expect(page).toContain("scopeHref('MARKETPLACE', pageSize)");
    expect(page).toContain("scopeHref('CAMPUS_WORK', pageSize)");
    expect(page).toContain("aria-current={scope === 'RESOURCE'");
  });

  it('clears cursor on scope changes and preserves scope/page size on next page', () => {
    expect(page).toContain(
      'return `/admin/tags?scope=${scope}&pageSize=${pageSize}`',
    );
    expect(page).toContain('page.nextCursor');
    expect(page).toContain('page.hasNextPage');
    expect(page).toContain(
      '`/admin/tags?scope=${scope}&pageSize=${pageSize}&cursor=${encodeURIComponent(page.nextCursor)}`',
    );
    expect(page).toContain('下一页');
    expect(component).toContain('router.refresh()');
    expect(component).not.toContain('router.push(');
    expect(component).not.toContain('router.replace(');
  });

  it('exposes tag navigation only inside the existing ADMIN branch', () => {
    expect(layout).toContain("user.role === 'ADMIN'");
    const adminBranch = layout.slice(layout.indexOf("user.role === 'ADMIN'"));
    expect(adminBranch).toContain('href="/admin/tags"');
    expect(adminBranch).toContain('标签管理');
  });

  it('uses semantic forms, native dialogs, a binary switch, and feedback without deletion', () => {
    expect(component).toContain("fetch('/api/admin/tags'");
    expect(component).toContain("action: 'CREATE_PRESET'");
    expect(component).toContain("action: 'SET_ACTIVE'");
    expect(component).toContain("action: 'PROMOTE_CUSTOM'");
    expect(component).toContain('<form');
    expect(component).toContain('<dialog');
    expect(component).toContain('type="checkbox"');
    expect(component).toContain('role="switch"');
    expect(component).toContain('name="reason"');
    expect(component).toContain('minLength={5}');
    expect(component).toContain('maxLength={1000}');
    expect(component).toContain('disabled={pending}');
    expect(component).toContain('aria-live="polite"');
    expect(component).toContain('router.refresh()');
    expect(component).toContain('预设');
    expect(component).toContain('自定义');
    expect(component).toContain('已启用');
    expect(component).toContain('已停用');
    expect(component).not.toContain("method: 'DELETE'");
    expect(component).not.toContain('永久删除');
    expect(component).not.toContain('campusId');
  });

  it('uses a flat compact responsive list without horizontal overflow', () => {
    expect(styles).toContain('.tag-admin');
    expect(styles).toContain('.tag-scope-tabs');
    expect(styles).toContain('.tag-management-list');
    expect(styles).toContain('.tag-management-row');
    const mobile = styles.slice(styles.indexOf('@media (max-width: 760px)'));
    expect(mobile).toContain('.tag-management-row');
    expect(mobile).toMatch(/\.tag-admin[\s\S]*?min-width:\s*0;/);
    expect(mobile).toContain('overflow-wrap: anywhere;');
  });
});

describe('tag audit subject expansion contract', () => {
  it('pins the MIT Unicode database case-folding implementation', () => {
    expect(manifest.dependencies['unicode-case-folding']).toBe('1.1.1');
    expect(
      lockfile.packages['node_modules/unicode-case-folding'],
    ).toMatchObject({ license: 'MIT', version: '1.1.1' });
  });

  it('keeps the pushed 190000 migration immutable', () => {
    expect(
      createHash('sha256').update(originalTagMigration).digest('hex'),
    ).toBe('f83646ce7fc5b8928d52189aae2f63cfdd486770e2afa2a3f0cef3dae27a2503');
    expect(originalTagMigration).not.toContain('TAG_DEFINITION');
  });

  it('adds TAG_DEFINITION only in the ordered expand-only 191000 migration', () => {
    expect(migration).toMatch(
      /ALTER TYPE "ModerationSubjectType" ADD VALUE IF NOT EXISTS 'TAG_DEFINITION';/,
    );
    expect(migration).not.toMatch(/DROP|DELETE|UPDATE|ALTER TABLE/i);
    expect(BigInt('20260713191000')).toBeLessThan(BigInt('20260713200000'));
    expect(schema).toMatch(
      /enum ModerationSubjectType\s*\{[\s\S]*?TAG_DEFINITION[\s\S]*?\}/,
    );
    expect(audit).toContain("'TAG_DEFINITION'");
  });
});
