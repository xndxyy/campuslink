import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(
    new URL('../integration/content-actions.test.ts', import.meta.url),
  ),
  'utf8',
);

describe('content actions integration coverage', () => {
  it('uses only the contracted CampusWorkPost storage path', () => {
    expect(source).toContain('tx.campusWorkPost.create({');
    expect(source).toContain('tx.campusWorkPost.update({');
    expect(source).toContain('tx.campusWorkPost.delete({');
    expect(source).not.toMatch(/\bJobPost\b/);
    expect(source).not.toMatch(/\bjobPost\b/);
    expect(source).not.toContain('_sync_job_post_to_campus_work');
  });

  it('probes direct CampusWork transactions with a controlled rollback', () => {
    expect(source).toContain('runCampusWorkSyncProbe');
    expect(source).toContain('campusWorkProbeRollback');
    expect(source).toContain(
      'if (error !== campusWorkProbeRollback) throw error',
    );
    expect(source).toContain('CampusWork capability drift');
  });

  it('covers inactive CampusWork tags through public and owner presenters', () => {
    const title =
      'presents an inactive historical CampusWork tag without leaking public contact';
    const start = source.indexOf(`it('${title}'`);
    const end = source.indexOf('\n  it(', start + 4);
    const testSource = source.slice(start, end === -1 ? undefined : end);

    expect(start).toBeGreaterThan(-1);
    expect(testSource).toContain('createCampusWorkPost(');
    expect(testSource).toContain("scope: 'CAMPUS_WORK'");
    expect(testSource).toContain('db.campusWorkPost.update({');
    expect(testSource).toContain("status: 'PUBLISHED'");
    expect(testSource).toContain('db.tagDefinition.update({');
    expect(testSource).toContain('listPublicContent(');
    expect(testSource).toContain('getPublicContent(');
    expect(testSource).toContain('getOwnedContent(');
    expect(testSource).toContain("!Object.hasOwn(publicListItem, 'contact')");
    expect(testSource).toContain("!Object.hasOwn(publicDetail, 'contact')");
  });

  it('runs owner CampusWork writes against a concurrent single-table update', () => {
    const title =
      'serializes owner and concurrent CampusWork writes without losing the row';
    const start = source.indexOf(`it('${title}'`);
    const end = source.indexOf('\n  it(', start + 4);
    const testSource = source.slice(start, end === -1 ? undefined : end);

    expect(start).toBeGreaterThan(-1);
    expect(testSource).toContain('editOwnedContent(');
    expect(testSource).toContain('archiveOwnedContent(');
    expect(testSource).toContain('submitOwnedDraft(');
    expect(testSource).toContain('Promise.allSettled');
    expect(testSource).toContain('FROM "CampusWorkPost"');
    expect(testSource).toContain("status: 'fulfilled'");
  });

  it('verifies real CampusWork trigram catalog metadata and query plans', () => {
    const title = 'uses every CampusWork trigram index for public search';
    const start = source.indexOf(`it('${title}'`);
    const end = source.indexOf('\n  it(', start + 4);
    const testSource = source.slice(start, end === -1 ? undefined : end);

    expect(start).toBeGreaterThan(-1);
    expect(testSource).toContain('pg_catalog.pg_index');
    expect(testSource).toContain("operatorClass: 'gin_trgm_ops'");
    expect(testSource).toContain('EXPLAIN (COSTS OFF)');
    expect(testSource).toContain('SET LOCAL enable_seqscan = off');
  });
});
