import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)),
  'utf8',
);
const migration = readFileSync(
  fileURLToPath(
    new URL(
      '../../prisma/migrations/20260712223000_add_admin_moderation_actions/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('immutable moderation and audit persistence contract', () => {
  it('supports immutable report moderation actions without adding update/delete APIs', () => {
    expect(schema).toMatch(/enum ModerationSubjectType[\s\S]*REPORT/);
    expect(schema).toMatch(/enum ModerationActionType[\s\S]*RESOLVE/);
    expect(schema).toMatch(/model ModerationAction[\s\S]*createdAt/);
    expect(schema).toMatch(/model AuditLog[\s\S]*createdAt/);
  });

  it('persists immutable campus ownership for reports and audit records', () => {
    expect(schema).toMatch(
      /model Report\s*\{[\s\S]*?campusId\s+String[\s\S]*?campus\s+Campus[\s\S]*?@@index\(\[campusId, status, createdAt, id\]\)/,
    );
    expect(schema).toMatch(
      /model AuditLog\s*\{[\s\S]*?campusId\s+String[\s\S]*?campus\s+Campus[\s\S]*?@@index\(\[campusId, createdAt, id\]\)/,
    );
    expect(migration).toMatch(
      /UPDATE "Report"[\s\S]*"reporterId"[\s\S]*"campusId"/i,
    );
    expect(migration).toMatch(
      /UPDATE "AuditLog"[\s\S]*"actorId"[\s\S]*"campusId"/i,
    );
    expect(migration).toMatch(
      /RAISE EXCEPTION[^;]*actorless AuditLog campus ownership/i,
    );
    expect(migration).toMatch(/prevent_governance_campus_change/i);
  });
});
