import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../e2e/publish-content.spec.ts', import.meta.url)),
  'utf8',
);
const cleanupHelperPath = fileURLToPath(
  new URL('../helpers/publish-content-cleanup.ts', import.meta.url),
);
const cleanupHelperSource = existsSync(cleanupHelperPath)
  ? readFileSync(cleanupHelperPath, 'utf8')
  : '';
const cleanupSource = `${source}\n${cleanupHelperSource}`;

describe('publish content live E2E navigation contract', () => {
  it('extracts publisher cleanup behind an injectable orchestrator', () => {
    expect(cleanupHelperSource).toContain(
      'export async function cleanupRunScopedPublisher',
    );
    expect(source).toContain("from '../helpers/publish-content-cleanup'");
    expect(source).toContain('cleanupRunScopedPublisher(publisher, {');
  });

  it('queues storage deletion before DB cleanup and deletes objects only after commit', () => {
    expect(
      cleanupHelperSource.indexOf('INSERT INTO "StorageDeletionJob"'),
    ).toBeLessThan(cleanupHelperSource.indexOf('DELETE FROM "User"'));
    expect(cleanupHelperSource.indexOf("client.query('COMMIT')")).toBeLessThan(
      cleanupHelperSource.indexOf('storage.deleteObject(job.storageKey)'),
    );
    expect(cleanupHelperSource).toContain('throw new AggregateError(errors');
  });

  it('uses a run-scoped publisher and removes its database and storage fixtures', () => {
    expect(source).toContain('randomUUID()');
    expect(source).toContain('INSERT INTO "User"');
    expect(source).toContain('DeleteObjectCommand');
    expect(cleanupSource).toContain('DELETE FROM "User" WHERE id = $1');
    expect(source).toContain('finally');
  });

  it('uses run-scoped custom tags and deletes only their exact definitions after user cascades', () => {
    expect(source).toContain('createPublishContentRunTags(runId)');
    expect(source).toContain('campusId: campus.rows[0].campusId');
    expect(source).toContain('publisher.customTags.resource.label');
    expect(source).toContain('publisher.customTags.marketplace.label');
    expect(source).toContain('publisher.customTags.campusWork.label');
    expect(
      cleanupSource.indexOf('DELETE FROM "User" WHERE id = $1'),
    ).toBeLessThan(cleanupSource.indexOf('DELETE FROM "TagDefinition"'));
    expect(cleanupSource).toContain('"campusId" = $1');
    expect(cleanupSource).toContain('"isPreset" = false');
    expect(cleanupSource).toContain('scope = $2::"TagScope"');
    expect(cleanupSource).toContain('label = $3');
    expect(cleanupSource).toContain('slug = $4');
    expect(cleanupSource).toContain('assertRunScopedTagJoinsRemoved');
    expect(cleanupSource).not.toMatch(/TagDefinition[\s\S]{0,300}\bLIKE\b/i);
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
