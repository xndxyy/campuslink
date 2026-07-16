import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import * as administration from '@/lib/domain/administration';
import * as userActionForm from '@/components/admin/user-action-form';
import * as userDetailPresentation from '@/components/admin/user-detail-labels';

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
    expect(submissions).toContain('最新审核决定');
  });

  it('provides pending, published, and hidden queues with valid actions', () => {
    const moderation = source('../../app/admin/moderation/page.tsx');
    expect(moderation).toContain("'PENDING'");
    expect(moderation).toContain("'PUBLISHED'");
    expect(moderation).toContain("'HIDDEN'");
    expect(moderation).toContain('action="HIDE"');
    expect(moderation).toContain('action="RESTORE"');
  });

  it('shows AI review details and a skipped-provider filter in moderation', () => {
    const moderation = source('../../app/admin/moderation/page.tsx');
    expect(moderation).toContain('未执行 AI 自动评估');
    expect(moderation).toContain('adminSignals');
    expect(moderation).toContain('hasSkippedAssessment');
    expect(moderation).toContain('含自定义标签');
    expect(moderation).toContain('riskScore');
    expect(moderation).toContain('providerStatus');
    expect(moderation).toContain(
      '/admin/moderation?status=PUBLISHED&providerStatus=SKIPPED',
    );
    expect(moderation).toContain("status !== 'REJECTED'");
  });

  it('links report targets and renders accessible immutable history', () => {
    const reports = source('../../app/admin/reports/page.tsx');
    expect(reports).toContain('查看被举报内容');
    expect(reports).toContain('历史审核记录');
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
    expect(audit).toContain('下一页');
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
    expect(drawer).toContain(
      'emailVerified={Boolean(overview.emailVerifiedAt)}',
    );
    expect(css).toContain('.admin-user-drawer');
    expect(css).toMatch(
      /@media \(max-width: 760px\)[\s\S]*\.admin-user-drawer/,
    );
  });

  it('translates user detail enums and audit metadata without raw JSON', () => {
    const drawer = optionalSource(
      '../../components/admin/user-detail-drawer.tsx',
    );
    const labels = optionalSource(
      '../../components/admin/user-detail-labels.ts',
    );
    for (const mapping of [
      "PUBLISHED: '已发布'",
      "RESOURCE: '学习资源'",
      "OTHER: '其他原因'",
      "OPEN: '待处理'",
      "USER_SESSIONS_REVOKED: '强制退出全部设备'",
      "return labels[value] ?? '其他治理事件'",
    ]) {
      expect(labels).toContain(mapping);
    }
    for (const helper of [
      'contentStatusLabel',
      'reportTargetTypeLabel',
      'reportReasonLabel',
      'reportStatusLabel',
      'auditActionLabel',
      'auditDetailRows',
    ]) {
      expect(drawer).toContain(helper);
    }
    for (const rawExpression of [
      '?? String(record.status)',
      '{String(report.targetType)}',
      '{String(report.reason)}',
      '<span>{String(report.status)}</span>',
      '<strong>{String(entry.action)}</strong>',
      'JSON.stringify(entry.details',
    ]) {
      expect(drawer).not.toContain(rawExpression);
    }
  });

  it('formats drawer timestamps in Asia/Shanghai independently of host TZ', () => {
    const format = (
      userDetailPresentation as unknown as {
        formatAdminDateTime?: (value: unknown) => string;
      }
    ).formatAdminDateTime;
    expect(format).toBeTypeOf('function');
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      const fromUtcHost = format!('2026-07-14T12:34:56.000Z');
      process.env.TZ = 'Asia/Shanghai';
      const fromShanghaiHost = format!('2026-07-14T12:34:56.000Z');
      expect(fromUtcHost).toBe(fromShanghaiHost);
      expect(fromUtcHost).toContain('20:34');
      expect(format!('not-a-date')).toBe('时间未知');
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }

    const drawer = source('../../components/admin/user-detail-drawer.tsx');
    expect(drawer).toContain('formatAdminDateTime');
    expect(drawer).toContain('adminDateTimeIso');
    expect(drawer).toContain('<time dateTime=');
    expect(drawer).not.toContain('toLocaleString');
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
    expect(form).toContain('emailVerified');
    expect(form).toContain("currentStatus === 'PENDING_VERIFICATION'");
    expect(form).toContain("currentStatus === 'SUSPENDED' && emailVerified");
    expect(form).toContain('管理员不能代为完成邮箱验证');
    expect(form).not.toContain("method: 'DELETE'");
    expect(form).not.toContain('emailVerifiedAt');
  });

  it('hard-navigates after self revocation and refreshes only other actions', () => {
    const complete = (
      userActionForm as unknown as {
        completeUserAction?: (
          result: { selfRevoked?: boolean },
          effects: {
            navigate: (href: string) => void;
            refresh: () => void;
          },
        ) => void;
      }
    ).completeUserAction;
    expect(complete).toBeTypeOf('function');
    const navigate = vi.fn();
    const refresh = vi.fn();
    complete!({ selfRevoked: true }, { navigate, refresh });
    expect(navigate).toHaveBeenCalledWith('/auth/sign-in');
    expect(refresh).not.toHaveBeenCalled();

    navigate.mockClear();
    complete!({ selfRevoked: false }, { navigate, refresh });
    expect(navigate).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
