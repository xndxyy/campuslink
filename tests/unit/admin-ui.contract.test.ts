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
  });
});
