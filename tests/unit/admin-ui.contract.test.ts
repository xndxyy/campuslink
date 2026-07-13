import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as administration from '@/lib/domain/administration';

function source(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

function optionalSource(path: string) {
  try {
    return source(path);
  } catch {
    return '';
  }
}

describe('moderator and administrator workspace contracts', () => {
  it('role-gates the admin layout and provides each real workspace', () => {
    const layout = source('../../app/admin/layout.tsx');
    expect(layout).toContain("requireRole(['MODERATOR', 'ADMIN'])");
    expect(layout).toContain('/admin/moderation');
    expect(layout).toContain('/admin/reports');
    expect(layout).toContain('/admin/users');
    expect(layout).toContain('/admin/audit-log');
  });

  it('uses accessible reason dialogs with pending, success, and error feedback', () => {
    const form = source('../../components/admin/moderation-action-form.tsx');
    expect(form).toContain('<dialog');
    expect(form).toContain('aria-labelledby');
    expect(form).toContain('aria-live="polite"');
    expect(form).toContain('disabled={pending}');
    expect(form).toContain("'/api/admin/moderation'");
  });

  it('has responsive admin tables/cards and explicit empty/error states', () => {
    const css = source('../../app/globals.css');
    const moderation = source('../../app/admin/moderation/page.tsx');
    expect(css).toContain('.admin-table');
    expect(css).toContain('@media (max-width: 760px)');
    expect(moderation).toContain('empty-state');
    expect(moderation).toContain('error-state');
    expect(moderation).not.toMatch(/fake|placeholder metric|mock metric/i);
  });

  it('shows the latest moderator decision reason on author submissions', () => {
    const submissions = source('../../app/me/submissions/page.tsx');
    expect(submissions).toContain('decisionReason');
    expect(submissions).toContain('decisionAction');
    expect(submissions).toContain('Latest moderator decision');
  });

  it('provides pending, published, and hidden queues with valid actions', () => {
    const moderation = source('../../app/admin/moderation/page.tsx');
    expect(moderation).toContain("'PENDING'");
    expect(moderation).toContain("'PUBLISHED'");
    expect(moderation).toContain("'HIDDEN'");
    expect(moderation).toContain('action="HIDE"');
    expect(moderation).toContain('action="RESTORE"');
  });

  it('links report targets and renders accessible immutable history', () => {
    const reports = source('../../app/admin/reports/page.tsx');
    expect(reports).toContain('Open target details');
    expect(reports).toContain('Prior moderation history');
    expect(reports).toContain('<Link');
  });

  it('populates strict audit filters and preserves them in a next-page link', () => {
    const audit = source('../../app/admin/audit-log/page.tsx');
    for (const filter of [
      'actor',
      'event',
      'entityType',
      'entityId',
      'from',
      'to',
      'pageSize',
      'cursor',
    ]) {
      expect(audit).toContain(`name="${filter}"`);
    }
    expect(audit).toContain('defaultValue');
    expect(audit).toContain('Next page');
  });

  it('provides a Chinese URL-driven user governance workspace', () => {
    const page = source('../../app/admin/users/page.tsx');
    const filters = optionalSource('../../components/admin/user-filters.tsx');
    const combined = `${page}\n${filters}`;
    expect(combined).toContain('用户治理');
    expect(combined).toContain('搜索姓名或邮箱');
    expect(combined).toContain('普通用户');
    expect(combined).toContain('角色');
    expect(combined).toContain('状态');
    expect(combined).toContain('验证状态');
    for (const field of [
      'search',
      'role',
      'status',
      'verified',
      'pageSize',
      'cursor',
    ]) {
      expect(filters).toContain(`name="${field}"`);
    }
    expect(filters).toContain('disabled name="cursor"');
    expect(page).toContain('nextCursor');
    expect(page).toContain('下一页');
    expect(combined).not.toContain('Student');
    expect(combined).not.toContain('已认证学生');
  });

  it('preserves list state when opening, switching, and closing user detail', () => {
    const builder = (
      administration as unknown as {
        buildManagedUsersHref?: (
          params: URLSearchParams,
          updates: Record<string, string | null>,
        ) => string;
      }
    ).buildManagedUsersHref;
    expect(builder).toBeTypeOf('function');
    const current = new URLSearchParams(
      'search=Alice&role=ADMIN&status=ACTIVE&verified=true&pageSize=10&cursor=opaque&user=user_1&tab=overview',
    );
    expect(builder!(current, { tab: 'audit' })).toBe(
      '/admin/users?search=Alice&role=ADMIN&status=ACTIVE&verified=true&pageSize=10&cursor=opaque&user=user_1&tab=audit',
    );
    expect(builder!(current, { tab: null, user: null })).toBe(
      '/admin/users?search=Alice&role=ADMIN&status=ACTIVE&verified=true&pageSize=10&cursor=opaque',
    );
  });

  it('uses an accessible responsive URL-driven detail drawer with four tabs', () => {
    const drawer = optionalSource(
      '../../components/admin/user-detail-drawer.tsx',
    );
    const css = source('../../app/globals.css');
    expect(drawer).toContain('<dialog');
    expect(drawer).toContain('aria-labelledby');
    expect(drawer).toContain('onCancel');
    expect(drawer).toContain('router.replace');
    for (const tab of ['账号概览', '发布内容', '举报记录', '审计记录']) {
      expect(drawer).toContain(tab);
    }
    expect(css).toContain('.admin-user-drawer');
    expect(css).toMatch(
      /@media \(max-width: 760px\)[\s\S]*\.admin-user-drawer/,
    );
  });

  it('requires a reason and explicit confirmation for every supported user action', () => {
    const form = source('../../components/admin/user-action-form.tsx');
    expect(form).toContain("action: 'SET_ROLE'");
    expect(form).toContain("action: 'SET_STATUS'");
    expect(form).toContain("action: 'REVOKE_SESSIONS'");
    expect(form).toContain('调整角色');
    expect(form).toContain('停用账号');
    expect(form).toContain('恢复账号');
    expect(form).toContain('强制退出全部设备');
    expect(form).toContain('<dialog');
    expect(form).toContain('确认执行');
    expect(form).toContain('minLength={5}');
    expect(form).toContain('aria-live="polite"');
    expect(form).toContain('disabled={pending}');
    expect(form).not.toContain("method: 'DELETE'");
    expect(form).not.toContain('emailVerifiedAt');
  });
});
