import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

const moderation = source('../e2e/moderation.spec.ts');
const gate = source('../helpers/e2e-environment.ts');

describe('fully parallel governance E2E isolation contract', () => {
  it('creates only run-scoped campus and account fixtures with a known password hash', () => {
    expect(moderation).toContain('INSERT INTO "Campus"');
    expect(moderation).toContain('INSERT INTO "User"');
    expect(moderation).toContain('randomUUID()');
    expect(moderation).toMatch(/\$2[aby]\$\d{2}\$/);
    expect(moderation).not.toContain('E2E_VERIFIED_EMAIL');
    expect(moderation).not.toContain('E2E_MODERATOR_EMAIL');
    expect(moderation).not.toContain('E2E_ADMIN_EMAIL');
    expect(moderation).not.toContain(
      "test.describe.configure({ mode: 'serial' })",
    );
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
      'JobPost',
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
});
