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
  it('gates CampusWork tests on the exact enabled legacy synchronization trigger', () => {
    expect(source).toContain("tgname = 'JobPost_campus_work_sync'");
    expect(source).toContain(`tgrelid = to_regclass('public."JobPost"')`);
    expect(source).toContain('NOT trigger.tgisinternal');
    expect(source).toContain("trigger.tgenabled = 'O'");
    expect(source).toContain('trigger.tgtype = 29');
    expect(source).toContain('JOIN pg_catalog.pg_proc AS function');
    expect(source).toContain('function.oid = trigger.tgfoid');
    expect(source).toContain(
      'JOIN pg_catalog.pg_namespace AS function_namespace',
    );
    expect(source).toContain("function_namespace.nspname = 'public'");
    expect(source).toContain(
      "function.proname = '_sync_job_post_to_campus_work'",
    );
    expect(source).toContain('pg_catalog.pg_get_triggerdef(trigger.oid, true)');
    expect(source).toContain('pg_catalog.pg_get_functiondef(trigger.tgfoid)');
    expect(source).toContain("TG_OP = ''DELETE''");
    expect(source).toContain("'CampusWorkPost'");
    expect(source).toContain('ON CONFLICT ("id") DO UPDATE SET');
    for (const field of [
      'authorId',
      'campusId',
      'company',
      'title',
      'description',
      'location',
      'payText',
      'status',
      'createdAt',
      'updatedAt',
    ]) {
      expect(source).toContain(`%"${field}" = EXCLUDED."${field}"%`);
    }
  });

  it('covers inactive CampusWork tags through public and owner presenters', () => {
    const title =
      'presents an inactive historical CampusWork tag without leaking public contact';
    const start = source.indexOf(`it('${title}'`);
    const end = source.indexOf('\n  it(', start + 4);
    const testSource = source.slice(start, end === -1 ? undefined : end);

    expect(start).toBeGreaterThan(-1);
    expect(source).toContain('getPublicContent,');
    expect(source).toContain('previousDefaultCampusSlug');
    expect(source).toContain('process.env.DEFAULT_CAMPUS_SLUG = campus.slug');
    expect(testSource).toContain('requireCampusWorkCapabilities(context)');
    expect(testSource).toContain('createCampusWorkPost(');
    expect(testSource).toContain("scope: 'CAMPUS_WORK'");
    expect(testSource).toContain('db.jobPost.update({');
    expect(testSource).toContain("status: 'PUBLISHED'");
    expect(testSource).toContain('db.tagDefinition.update({');
    expect(testSource).toContain('data: { isActive: false }');
    expect(testSource).toContain('listPublicContent(');
    expect(testSource).toContain('getPublicContent(');
    expect(testSource).toContain('getOwnedContent(');
    expect(testSource.match(/'campus-work'/g)?.length).toBeGreaterThanOrEqual(
      3,
    );
    expect(testSource.match(/isActive: false/g)?.length).toBeGreaterThanOrEqual(
      3,
    );
    expect(testSource).toContain("!Object.hasOwn(publicListItem, 'contact')");
    expect(testSource).toContain("!Object.hasOwn(publicDetail, 'contact')");
    expect(testSource).toContain('contact,');
  });
});
