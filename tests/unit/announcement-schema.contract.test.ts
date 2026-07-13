import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)),
  'utf8',
);
const migrationPath = fileURLToPath(
  new URL(
    '../../prisma/migrations/20260713170000_add_announcements/migration.sql',
    import.meta.url,
  ),
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';

describe('announcement persistence schema', () => {
  it('adds announcement-specific asset and moderation enum values', () => {
    expect(schema).toMatch(
      /enum AssetKind\s*\{[\s\S]*?ANNOUNCEMENT_IMAGE[\s\S]*?\}/,
    );
    expect(schema).toMatch(
      /enum ModerationSubjectType\s*\{[\s\S]*?ANNOUNCEMENT[\s\S]*?\}/,
    );
    expect(migration).toMatch(
      /ALTER TYPE "AssetKind" ADD VALUE 'ANNOUNCEMENT_IMAGE'/,
    );
    expect(migration).toMatch(
      /ALTER TYPE "ModerationSubjectType" ADD VALUE 'ANNOUNCEMENT'/,
    );
  });

  it('models announcements with restrictive ownership and a stable listing index', () => {
    expect(schema).toMatch(
      /model Announcement\s*\{[\s\S]*?id\s+String\s+@id\s+@default\(cuid\(\)\)[\s\S]*?campusId\s+String[\s\S]*?authorId\s+String[\s\S]*?title\s+String\s+@db\.VarChar\(200\)[\s\S]*?body\s+String\s+@db\.Text[\s\S]*?isPinned\s+Boolean\s+@default\(false\)[\s\S]*?publishedAt\s+DateTime\s+@default\(now\(\)\)/,
    );
    expect(schema).toMatch(
      /model Announcement\s*\{[\s\S]*?campus\s+Campus\s+@relation\([^\n]*onDelete:\s*Restrict\)[\s\S]*?author\s+User\s+@relation\([^\n]*onDelete:\s*Restrict\)/,
    );
    expect(schema).toMatch(
      /model Announcement\s*\{[\s\S]*?cover\s+Asset\?[\s\S]*?createdAt\s+DateTime\s+@default\(now\(\)\)[\s\S]*?updatedAt\s+DateTime\s+@updatedAt[\s\S]*?@@index\(\[campusId, isPinned, publishedAt, id\]\)/,
    );
    expect(schema).toMatch(
      /model Campus\s*\{[\s\S]*?announcements\s+Announcement\[\]/,
    );
    expect(schema).toMatch(
      /model User\s*\{[\s\S]*?announcements\s+Announcement\[\]/,
    );
  });

  it('allows at most one cover asset per announcement and nulls it on deletion', () => {
    expect(schema).toMatch(
      /model Asset\s*\{[\s\S]*?announcementId\s+String\?\s+@unique/,
    );
    expect(schema).toMatch(
      /model Asset\s*\{[\s\S]*?announcement\s+Announcement\?\s+@relation\([^\n]*fields:\s*\[announcementId\][^\n]*onDelete:\s*SetNull\)/,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "Asset_announcementId_key"\s+ON "Asset"\("announcementId"\)/,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("announcementId"\)\s+REFERENCES "Announcement"\("id"\)\s+ON DELETE SET NULL/,
    );
  });

  it('adds a durable and uniquely keyed storage deletion outbox', () => {
    expect(schema).toMatch(
      /model StorageDeletionJob\s*\{[\s\S]*?id\s+String\s+@id\s+@default\(cuid\(\)\)[\s\S]*?storageKey\s+String\s+@unique\s+@db\.VarChar\(512\)[\s\S]*?attempts\s+Int\s+@default\(0\)[\s\S]*?nextAttempt\s+DateTime\s+@default\(now\(\)\)[\s\S]*?lastError\s+String\?\s+@db\.VarChar\(200\)[\s\S]*?createdAt\s+DateTime\s+@default\(now\(\)\)[\s\S]*?@@index\(\[nextAttempt, id\]\)/,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "StorageDeletionJob_storageKey_key"\s+ON "StorageDeletionJob"\("storageKey"\)/,
    );
    expect(migration).toMatch(
      /CREATE INDEX "StorageDeletionJob_nextAttempt_id_idx"\s+ON "StorageDeletionJob"\("nextAttempt", "id"\)/,
    );
  });

  it('is expand-only and preserves every existing asset as an unassigned cover', () => {
    expect(migration).not.toMatch(/\b(?:DROP|RENAME|TRUNCATE)\b/i);
    expect(migration).toMatch(
      /ALTER TABLE "Asset"\s+ADD COLUMN "announcementId" TEXT/,
    );
    expect(migration).not.toMatch(
      /UPDATE\s+"Asset"[\s\S]*?"announcementId"\s*=/i,
    );
  });
});
