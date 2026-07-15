import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

const moderation = source('../e2e/moderation.spec.ts');
const userManagement = source('../e2e/user-management.spec.ts');
const gate = source('../helpers/e2e-environment.ts');
const safetyPath = fileURLToPath(
  new URL('../helpers/e2e-database-safety.ts', import.meta.url),
);
const safety = existsSync(safetyPath) ? readFileSync(safetyPath, 'utf8') : '';
const commonSafety = source('../helpers/database-safety.ts');

describe('fully parallel governance E2E isolation contract', () => {
  it('creates only run-scoped campus and accounts with a secret random credential', () => {
    expect(moderation).toContain('INSERT INTO "Campus"');
    expect(moderation).toContain('INSERT INTO "User"');
    expect(moderation).toContain('randomUUID()');
    expect(moderation).toContain('randomBytes(32)');
    expect(moderation).toContain('await hash(password, 12)');
    expect(moderation).not.toMatch(/\$2[aby]\$\d{2}\$/);
    expect(moderation).not.toMatch(/const password\s*=\s*['"`]/);
    expect(moderation).not.toContain('E2E_VERIFIED_EMAIL');
    expect(moderation).not.toContain('E2E_MODERATOR_EMAIL');
    expect(moderation).not.toContain('E2E_ADMIN_EMAIL');
    expect(moderation).not.toContain(
      "test.describe.configure({ mode: 'serial' })",
    );
  });

  it('fails closed before opening the database unless destructive E2E is explicitly safe', () => {
    expect(safety).toContain('ALLOW_DESTRUCTIVE_E2E');
    expect(safety).toContain('assertSafeTestDatabase(environment)');
    expect(commonSafety).toContain("NODE_ENV === 'production'");
    expect(commonSafety).toMatch(/_e2e\|_test/);
    const guard = moderation.indexOf(
      'assertSafeDestructiveE2eEnvironment(process.env)',
    );
    const pool = moderation.indexOf('new Pool(');
    expect(guard).toBeGreaterThan(-1);
    expect(pool).toBeGreaterThan(guard);
  });

  it('captures each browser session by hashing the actual cookie value', () => {
    expect(moderation).toContain("createHash('sha256')");
    expect(moderation).toContain('.update(sessionCookie.value)');
    expect(moderation).toMatch(
      /FROM "Session"\s+WHERE "sessionTokenHash" = \$1/,
    );
    expect(moderation).not.toMatch(
      /FROM "Session"[\s\S]{0,200}ORDER BY "createdAt" DESC/,
    );
  });

  it('deletes every fixture category by tracked primary key', () => {
    for (const table of [
      'Session',
      'AuditLog',
      'ModerationAction',
      'Favourite',
      'Report',
      'Asset',
      'Resource',
      'MarketplaceItem',
      'CampusWorkPost',
      'User',
      'Campus',
    ]) {
      expect(moderation).toMatch(
        new RegExp(
          `DELETE FROM "${table}" WHERE id = ANY\\(\\$1::text\\[\\]\\)`,
        ),
      );
    }
    expect(moderation).not.toMatch(/DELETE FROM "[^"]+" WHERE "campusId"/);
  });

  it('keeps the global browser gate limited to infrastructure', () => {
    const requiredBlock = gate.match(
      /requiredE2eEnvironment\s*=\s*\[[\s\S]*?\]\s+as const/,
    )?.[0];
    expect(requiredBlock).toContain('APP_URL');
    expect(requiredBlock).not.toContain('E2E_VERIFIED_EMAIL');
    expect(requiredBlock).not.toContain('E2E_MODERATOR_EMAIL');
    expect(requiredBlock).not.toContain('E2E_ADMIN_EMAIL');
  });

  it('selects managed users by an exact email cell instead of row substring text', () => {
    expect(moderation).toContain('getByText(email, { exact: true })');
    expect(moderation).toContain('filter({ has: emailText })');
    expect(moderation).not.toContain('filter({ hasText: email })');
  });

  it('proves cursor pagination advances without duplicates and preserves filters', () => {
    expect(userManagement).toContain(
      '/admin/users?pageSize=1&role=STUDENT&status=ACTIVE&verified=true',
    );
    expect(userManagement).toContain('const firstPageUserId');
    expect(userManagement).toContain("searchParams.get('cursor')");
    expect(userManagement).toContain("searchParams.get('pageSize')");
    expect(userManagement).toContain("searchParams.get('role')");
    expect(userManagement).toContain('const secondPageUserId');
    expect(userManagement).toContain(
      'expect(secondPageUserId).not.toBe(firstPageUserId)',
    );
    expect(userManagement).toContain('toHaveCount(0)');
  });
});
