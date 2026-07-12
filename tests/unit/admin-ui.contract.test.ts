import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
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
});
