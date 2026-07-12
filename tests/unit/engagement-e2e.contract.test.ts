import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../e2e/favourite-report.spec.ts', import.meta.url)),
  'utf8',
);

describe('engagement live E2E isolation contract', () => {
  it('establishes and cleans deterministic database preconditions', () => {
    expect(source).toContain('new Pool');
    expect(source).toContain('test.beforeAll');
    expect(source).toContain('test.afterAll');
    expect(source).toContain('DELETE FROM "Favourite"');
    expect(source).toContain('DELETE FROM "Report"');
    expect(source).toMatch(/sellerId\s*===\s*reporterId/);
  });

  it('exercises both favourite states through the real browser flow', () => {
    expect(source).toContain("name: 'Add favourite'");
    expect(source).toContain("name: 'Remove favourite'");
    expect(source).not.toMatch(/Report received\|open report already exists/);
  });

  it('captures and deletes only the contact audit created by this run', () => {
    expect(source).toContain('setupStartedAt');
    expect(source).toContain('contactAuditId');
    expect(source).toContain('MARKETPLACE_CONTACT_REQUESTED');
    expect(source).toMatch(/"campusId"\s*=\s*\$1/);
    expect(source).toMatch(/"createdAt"\s*>\s*\$4/);
    expect(source).toContain('test.afterEach');
    const auditDeletes = source.match(/DELETE FROM "AuditLog"[^`]+/g) ?? [];
    expect(auditDeletes).toHaveLength(1);
    expect(auditDeletes[0]).toMatch(/WHERE id = \$1/);
    expect(auditDeletes[0]).not.toContain('actorId');
  });
});
