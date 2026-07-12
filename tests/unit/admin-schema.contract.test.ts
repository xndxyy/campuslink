import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)),
  'utf8',
);
const originalMigration = `ALTER TYPE "ModerationSubjectType" ADD VALUE IF NOT EXISTS 'CAMPUS';
ALTER TYPE "ModerationSubjectType" ADD VALUE IF NOT EXISTS 'REPORT';

ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'ARCHIVE';
ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'TRIAGE';
ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'DISMISS';
ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'RESOLVE';
`;
const originalMigrationPath = fileURLToPath(
  new URL(
    '../../prisma/migrations/20260712223000_add_admin_moderation_actions/migration.sql',
    import.meta.url,
  ),
);
const governanceMigrationPath = fileURLToPath(
  new URL(
    '../../prisma/migrations/20260712230000_add_governance_campus_ownership/migration.sql',
    import.meta.url,
  ),
);
const governanceMigration = existsSync(governanceMigrationPath)
  ? readFileSync(governanceMigrationPath, 'utf8')
  : '';

describe('immutable moderation and audit persistence contract', () => {
  it('keeps the originally committed moderation migration byte-for-byte unchanged', () => {
    const migration = readFileSync(originalMigrationPath, 'utf8');
    expect(migration).toBe(originalMigration);
    expect(createHash('sha256').update(migration).digest('hex')).toBe(
      'd05c87a25b27f439adfe45797586a0a5e2299506c4d38260f9d67df1d054da4b',
    );
  });

  it('moves campus ownership into a later migration and schema models', () => {
    expect(governanceMigration).not.toBe('');
    expect(schema).toMatch(
      /model Report\s*\{[\s\S]*?campusId\s+String[\s\S]*?campus\s+Campus[\s\S]*?@@index\(\[campusId, status, createdAt, id\]\)/,
    );
    expect(schema).toMatch(
      /model AuditLog\s*\{[\s\S]*?campusId\s+String[\s\S]*?campus\s+Campus[\s\S]*?@@index\(\[campusId, createdAt, id\]\)/,
    );
    expect(schema).toMatch(/model AuditLogQuarantine\s*\{/);
    expect(governanceMigration).toMatch(
      /ALTER TABLE "AuditLog" ADD COLUMN "campusId" TEXT;/,
    );
    expect(governanceMigration).toMatch(
      /ALTER TABLE "AuditLog" ALTER COLUMN "campusId" SET NOT NULL;/,
    );
  });

  it('backfills actorless audit ownership deterministically before quarantining unresolved rows', () => {
    expect(governanceMigration).toMatch(
      /UPDATE "Report"[\s\S]*FROM "User"[\s\S]*"reporterId"/i,
    );
    expect(governanceMigration).toMatch(
      /UPDATE "AuditLog"[\s\S]*FROM "User"[\s\S]*"actorId"/i,
    );
    for (const entityType of [
      'CAMPUS',
      'USER',
      'RESOURCE',
      'MARKETPLACE_ITEM',
      'JOB_POST',
      'ASSET',
      'REPORT',
    ]) {
      expect(governanceMigration).toMatch(
        new RegExp(`subjectType" = '${entityType}'`),
      );
    }
    expect(governanceMigration).toMatch(
      /CREATE TABLE "AuditLogQuarantine"[\s\S]*"originalId"[\s\S]*"event"[\s\S]*"entityType"[\s\S]*"entityId"[\s\S]*"metadata"[\s\S]*"originalCreatedAt"[\s\S]*"reason"/,
    );
    const quarantine = governanceMigration.indexOf(
      'INSERT INTO "AuditLogQuarantine"',
    );
    const deletion = governanceMigration.indexOf('DELETE FROM "AuditLog"');
    const notNull = governanceMigration.indexOf(
      'ALTER TABLE "AuditLog" ALTER COLUMN "campusId" SET NOT NULL',
    );
    expect(quarantine).toBeGreaterThan(-1);
    expect(deletion).toBeGreaterThan(quarantine);
    expect(notNull).toBeGreaterThan(deletion);
    expect(governanceMigration).toMatch(
      /DELETE FROM "AuditLog"[\s\S]*USING "AuditLogQuarantine"[\s\S]*"originalId"/,
    );
    expect(governanceMigration).not.toMatch(
      /IF EXISTS[\s\S]*RAISE EXCEPTION[^;]*actorless/i,
    );
  });

  it('supports immutable report moderation actions without update/delete APIs', () => {
    expect(schema).toMatch(/enum ModerationSubjectType[\s\S]*REPORT/);
    expect(schema).toMatch(/enum ModerationActionType[\s\S]*RESOLVE/);
    expect(schema).toMatch(/model ModerationAction[\s\S]*createdAt/);
  });
});
