import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../e2e/publish-content.spec.ts', import.meta.url)),
  'utf8',
);

describe('publish content live E2E navigation contract', () => {
  it('uses a run-scoped publisher and removes its database and storage fixtures', () => {
    expect(source).toContain('randomUUID()');
    expect(source).toContain('INSERT INTO "User"');
    expect(source).toContain('DeleteObjectCommand');
    expect(source).toContain('DELETE FROM "User" WHERE id = $1');
    expect(source).toContain('finally');
  });

  it('deletes only the exact browser session identified by its cookie hash', () => {
    expect(source).toContain("createHash('sha256')");
    expect(source).toContain('.update(sessionCookie.value)');
    expect(source).toMatch(
      /DELETE FROM "Session" WHERE "sessionTokenHash" = \$1/,
    );
  });

  it('waits for the submissions list pathname rather than matching the edit URL', () => {
    expect(source).toMatch(
      /toHaveURL\(\s*\(url\)\s*=>\s*url\.pathname\s*===\s*['"]\/me\/submissions['"]\s*,?\s*\)/,
    );
    expect(source).not.toContain('toHaveURL(/me\\/submissions/)');
  });

  it('restores the shared rejected fixture after editing and resubmitting it', () => {
    expect(source).toContain('originalRejectedResource');
    expect(source).toContain('UPDATE "Resource"');
    expect(source).toMatch(/status = \$6::"ContentStatus"/);
    expect(source).toContain('finally');
  });
});
