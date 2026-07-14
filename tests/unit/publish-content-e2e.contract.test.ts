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
  it('fails closed before constructing destructive database or storage clients', () => {
    const sharedGate = source.indexOf(
      'const runSharedAccountE2e = shouldRunSharedAccountE2e(process.env);',
    );
    const conditionalGuard = source.indexOf('if (runSharedAccountE2e) {');
    const safetyAssertion = source.indexOf(
      'assertSafeDestructiveE2eEnvironment(process.env);',
    );
    const skip = source.indexOf('test.skip(');
    const firstPool = source.indexOf('new Pool');
    const firstStorageClient = source.indexOf('new S3Client');

    expect(source).toContain("from '../helpers/e2e-database-safety'");
    expect(sharedGate).toBeGreaterThan(-1);
    expect(conditionalGuard).toBeGreaterThan(sharedGate);
    expect(safetyAssertion).toBeGreaterThan(conditionalGuard);
    expect(skip).toBeGreaterThan(safetyAssertion);
    expect(firstPool).toBeGreaterThan(safetyAssertion);
    expect(firstStorageClient).toBeGreaterThan(safetyAssertion);
    expect(source).toContain('isolated destructive test database');
  });

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

  it('publishes run-scoped campus work and verifies audited non-owner contact reveal', () => {
    expect(source).toContain('SELECT id, contact');
    expect(source).toContain('FROM "CampusWorkPost"');
    expect(source).toContain('"authorId" = $1');
    expect(source).toContain('title = $2');
    expect(source).toContain('publisher.runId');
    expect(source).toContain('UPDATE "JobPost"');
    expect(source).toContain("status = 'PUBLISHED'");
    expect(source).toContain('page.context().clearCookies()');
    expect(source).toContain('process.env.E2E_OTHER_EMAIL!');
    expect(source).toContain('process.env.E2E_OTHER_PASSWORD!');
    expect(source).toContain('`/campus-work/${campusWork.id}`');
    expect(source).toMatch(
      /getByRole\(\s*'button',\s*\{\s*name:\s*'查看联系方式',?\s*\},?\s*\)/,
    );
    expect(source).toContain(
      "'联系方式访问已记录，请注意线下见面与付款安全。'",
    );
    expect(source).toContain('FROM "AuditLog"');
    expect(source).toContain("'CAMPUS_WORK_CONTACT_VIEWED'");
    expect(source).toContain("'JOB_POST'");
    expect(source).toContain('toHaveLength(1)');
    expect(source).toMatch(
      /JSON\.stringify\([^)]*audit[^)]*\)\)\.not\.toContain\(campusWork\.contact\)/,
    );
  });

  it('deletes only exact run-scoped contact audit rows inside cleanup', () => {
    expect(cleanupHelperSource).toContain('auditSubjects?: Array');
    expect(cleanupHelperSource).toContain('DELETE FROM "AuditLog"');
    expect(cleanupHelperSource).toContain('"campusId" = $1');
    expect(cleanupHelperSource).toContain('action = $2');
    expect(cleanupHelperSource).toContain(
      '"subjectType" = $3::"ModerationSubjectType"',
    );
    expect(cleanupHelperSource).toContain('"subjectId" = $4');
    expect(cleanupHelperSource).toContain('"actorId" = $5');
    expect(cleanupHelperSource).toContain('deletedAudit.rowCount > 1');
  });
});
