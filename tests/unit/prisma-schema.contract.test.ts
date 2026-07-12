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
      '../../prisma/migrations/20260712044000_init/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('Prisma schema contract', () => {
  it('allows a pending user to have no credential hash until link-holder activation', () => {
    expect(schema).toMatch(
      /model User\s*\{[\s\S]*?passwordHash\s+String\?\s+@db\.VarChar\(255\)/,
    );
  });

  it('has an unapplied migration making pending credentials nullable', () => {
    const pendingCredentialMigration = readFileSync(
      fileURLToPath(
        new URL(
          '../../prisma/migrations/20260712080000_harden_authentication/migration.sql',
          import.meta.url,
        ),
      ),
      'utf8',
    );

    expect(pendingCredentialMigration).toMatch(
      /ALTER COLUMN "passwordHash" DROP NOT NULL/,
    );
  });

  it('clears legacy credential hashes only for pending users during upgrade', () => {
    const pendingCredentialMigration = readFileSync(
      fileURLToPath(
        new URL(
          '../../prisma/migrations/20260712080000_harden_authentication/migration.sql',
          import.meta.url,
        ),
      ),
      'utf8',
    );
    const credentialBackfills = pendingCredentialMigration.match(
      /UPDATE\s+"User"\s+SET\s+"passwordHash"\s*=\s*NULL[\s\S]*?;/g,
    );

    expect(credentialBackfills).toEqual([
      expect.stringMatching(
        /^UPDATE\s+"User"\s+SET\s+"passwordHash"\s*=\s*NULL\s+WHERE\s+"status"\s*=\s*'PENDING_VERIFICATION'\s*;$/,
      ),
    ]);
  });

  it('models expiring shared rate-limit buckets keyed only by a hash', () => {
    expect(schema).toMatch(
      /model RateLimitBucket\s*\{[\s\S]*?keyHash\s+String\s+@id\s+@db\.VarChar\(64\)[\s\S]*?windowStartedAt\s+DateTime[\s\S]*?count\s+Int[\s\S]*?expiresAt\s+DateTime/,
    );
  });

  it('models resource documents and marketplace images as attachable assets', () => {
    expect(schema).toMatch(/enum AssetKind\s*\{[\s\S]*?RESOURCE_DOCUMENT/);
    expect(schema).toMatch(
      /model Asset\s*\{[\s\S]*?resourceId\s+String\?[\s\S]*?marketplaceItemId\s+String\?/,
    );
    expect(schema).toContain('@relation("ResourceAssets"');
    expect(schema).toContain('@relation("MarketplaceItemAssets"');
    expect(schema).toMatch(
      /model Resource\s*\{[\s\S]*?assets\s+Asset\[\]\s+@relation\("ResourceAssets"\)/,
    );
    expect(schema).toMatch(
      /model MarketplaceItem\s*\{[\s\S]*?assets\s+Asset\[\]\s+@relation\("MarketplaceItemAssets"\)/,
    );
  });

  it('stores only a unique hash for verification tokens', () => {
    expect(schema).toMatch(
      /model VerificationToken\s*\{[\s\S]*?tokenHash\s+String\s+@unique/,
    );
    expect(schema).not.toMatch(/\n\s*token\s+String(?:\?|\s)/);
    expect(schema).not.toContain('@@unique([identifier, token])');
  });

  it('stores only a unique hash for opaque server sessions', () => {
    expect(schema).toMatch(
      /model Session\s*\{[\s\S]*?sessionTokenHash\s+String\s+@unique/,
    );
    expect(schema).not.toMatch(
      /model Session\s*\{[\s\S]*?sessionToken\s+String(?:\?|\s)/,
    );
  });

  it('does not retain legacy provider token fields when social authentication is absent', () => {
    expect(schema).not.toContain('model Account');
    expect(schema).not.toMatch(/(?:access|refresh|id)_token/);
    expect(migration).not.toContain('CREATE TABLE "Account"');
    expect(migration).not.toMatch(/(?:access|refresh|id)_token/);
  });
});

describe('upload expiry migration contract', () => {
  it('backfills existing unfinished assets before indexing expiry', () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          '../../prisma/migrations/20260712100000_add_upload_expiry/migration.sql',
          import.meta.url,
        ),
      ),
      'utf8',
    );

    expect(migration).toMatch(
      /UPDATE "Asset"[\s\S]*"uploadExpiresAt"\s*=\s*"createdAt"\s*\+\s*INTERVAL '5 minutes'/,
    );
    expect(migration).toMatch(
      /"status" IN \('PENDING', 'REJECTED'\)[\s\S]*"uploadExpiresAt" IS NULL/,
    );
    expect(migration).toMatch(/Asset_status_uploadExpiresAt_idx/);
  });
});
