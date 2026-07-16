import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../e2e/favourite-report.spec.ts', import.meta.url)),
  'utf8',
);

describe('engagement live E2E isolation contract', () => {
  it('establishes and cleans deterministic database preconditions', () => {
    expect(source).toContain('randomUUID()');
    expect(source).toContain('INSERT INTO "User"');
    expect(source).toContain('INSERT INTO "MarketplaceItem"');
    expect(source).toContain('new Pool');
    expect(source).toContain('test.beforeAll');
    expect(source).toContain('test.afterAll');
    expect(source).toContain('DELETE FROM "Report" WHERE id = $1');
    expect(source).toContain('DELETE FROM "MarketplaceItem" WHERE id = $1');
    expect(source).toContain('DELETE FROM "User" WHERE id = $1');
    expect(source).not.toMatch(
      /DELETE FROM "Report"[\s\S]{0,200}"reporterId" = \$1/,
    );
    expect(source).toMatch(/source\.sellerId\s*===\s*reporterId/);
  });

  it('exercises both favourite states through the real browser flow', () => {
    expect(source).toContain("name: '收藏'");
    expect(source).toContain("name: '取消收藏'");
    expect(source).not.toMatch(/Report received\|open report already exists/);
  });

  it('captures and deletes only the contact audit created by this run', () => {
    expect(source).toContain('contactAuditId');
    expect(source).toContain('reportId');
    expect(source).toContain('MARKETPLACE_CONTACT_REQUESTED');
    expect(source).toMatch(/"campusId"\s*=\s*\$1/);
    expect(source).toContain('test.afterAll');
    const auditDeletes = source.match(/DELETE FROM "AuditLog"[^`]+/g) ?? [];
    expect(auditDeletes).toHaveLength(1);
    expect(auditDeletes[0]).toMatch(/WHERE id = \$1/);
    expect(auditDeletes[0]).not.toContain('actorId');
  });

  it('owns only the browser session identified by its exact cookie hash', () => {
    expect(source).toContain("createHash('sha256')");
    expect(source).toContain('.update(sessionCookie.value)');
    expect(source).toMatch(/FROM "Session"\s+WHERE "sessionTokenHash" = \$1/);
    expect(source).not.toMatch(
      /FROM "Session"[\s\S]{0,200}ORDER BY "createdAt" DESC/,
    );
  });
});
