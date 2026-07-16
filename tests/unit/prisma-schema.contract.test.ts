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
const seedSource = readFileSync(
  fileURLToPath(new URL('../../prisma/seed.ts', import.meta.url)),
  'utf8',
);

function model(name: string) {
  return (
    schema.match(new RegExp(`model ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ??
    ''
  );
}

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

describe('scoped tag schema contract', () => {
  it('defines the three governed tag scopes', () => {
    expect(schema).toMatch(
      /enum TagScope\s*\{\s*RESOURCE\s+MARKETPLACE\s+CAMPUS_WORK\s*\}/,
    );
  });

  it('scopes tag definitions by campus, content kind, and slug', () => {
    const tagDefinition = model('TagDefinition');

    expect(tagDefinition).toMatch(/id\s+String\s+@id\s+@default\(cuid\(\)\)/);
    expect(tagDefinition).toMatch(/campusId\s+String/);
    expect(tagDefinition).toMatch(/scope\s+TagScope/);
    expect(tagDefinition).toMatch(/label\s+String\s+@db\.VarChar\(32\)/);
    expect(tagDefinition).toMatch(/slug\s+String\s+@db\.VarChar\(40\)/);
    expect(tagDefinition).toMatch(/isPreset\s+Boolean\s+@default\(false\)/);
    expect(tagDefinition).toMatch(/isActive\s+Boolean\s+@default\(true\)/);
    expect(tagDefinition).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(tagDefinition).toMatch(
      /campus\s+Campus\s+@relation\(fields: \[campusId\], references: \[id\], onDelete: Restrict\)/,
    );
    expect(tagDefinition).toContain('@@unique([campusId, scope, slug])');
    expect(tagDefinition).toContain('@@unique([id, campusId, scope])');
    expect(tagDefinition).toContain(
      '@@index([campusId, scope, isActive, label])',
    );
    expect(model('Campus')).toMatch(/tagDefinitions\s+TagDefinition\[\]/);
  });

  it('uses explicit indexed join models with cascading content and restricted tags', () => {
    for (const [
      join,
      contentModel,
      contentField,
      contentId,
      reverseField,
      scope,
    ] of [
      [
        'ResourceTag',
        'Resource',
        'resource',
        'resourceId',
        'resourceTags',
        'RESOURCE',
      ],
      [
        'MarketplaceTag',
        'MarketplaceItem',
        'marketplaceItem',
        'marketplaceItemId',
        'marketplaceTags',
        'MARKETPLACE',
      ],
      [
        'CampusWorkTag',
        'CampusWorkPost',
        'campusWorkPost',
        'campusWorkPostId',
        'campusWorkTags',
        'CAMPUS_WORK',
      ],
    ] as const) {
      const joinModel = model(join);
      expect(joinModel).toMatch(new RegExp(`${contentId}\\s+String`));
      expect(joinModel).toMatch(/tagId\s+String/);
      expect(joinModel).toMatch(/campusId\s+String/);
      expect(joinModel).toMatch(
        new RegExp(`scope\\s+TagScope\\s+@default\\(${scope}\\)`),
      );
      expect(joinModel).toMatch(
        new RegExp(
          `${contentField}\\s+${contentModel}\\s+@relation\\(fields: \\[${contentId}\\], references: \\[id\\], onDelete: Cascade\\)`,
        ),
      );
      expect(joinModel).toMatch(
        /tag\s+TagDefinition\s+@relation\(fields: \[tagId, campusId, scope\], references: \[id, campusId, scope\], onDelete: Restrict\)/,
      );
      expect(joinModel).toContain(`@@id([${contentId}, tagId])`);
      expect(joinModel).toContain(`@@index([tagId, ${contentId}])`);
      expect(model('TagDefinition')).toMatch(
        new RegExp(`${reverseField}\\s+${join}\\[\\]`),
      );
    }

    expect(model('Resource')).toMatch(/tagAssignments\s+ResourceTag\[\]/);
    expect(model('MarketplaceItem')).toMatch(
      /tagAssignments\s+MarketplaceTag\[\]/,
    );
    expect(model('CampusWorkPost')).toMatch(
      /tagAssignments\s+CampusWorkTag\[\]/,
    );
  });

  it('keeps the contracted CampusWorkPost model without obsolete job fields', () => {
    const campusWork = model('CampusWorkPost');

    expect(campusWork).toMatch(/id\s+String\s+@id\s+@default\(cuid\(\)\)/);
    expect(campusWork).toMatch(/authorId\s+String/);
    expect(campusWork).toMatch(/campusId\s+String/);
    expect(campusWork).not.toMatch(/company\s+String/);
    expect(campusWork).toMatch(/title\s+String\s+@db\.VarChar\(200\)/);
    expect(campusWork).toMatch(/description\s+String\s+@db\.Text/);
    expect(campusWork).toMatch(/location\s+String\s+@db\.VarChar\(200\)/);
    expect(campusWork).toMatch(/payText\s+String\s+@db\.VarChar\(200\)/);
    expect(campusWork).toMatch(/contact\s+String\?\s+@db\.Text/);
    expect(campusWork).toMatch(/status\s+ContentStatus\s+@default\(DRAFT\)/);
    expect(campusWork).toMatch(
      /author\s+User\s+@relation\("CampusWorkAuthor", fields: \[authorId\], references: \[id\], onDelete: Cascade\)/,
    );
    expect(campusWork).toMatch(
      /campus\s+Campus\s+@relation\(fields: \[campusId\], references: \[id\], onDelete: Restrict\)/,
    );
    expect(campusWork).toContain('@@index([campusId, status, createdAt, id])');
    expect(campusWork).toContain('@@index([authorId, status])');
    expect(model('Campus')).toMatch(/campusWorkPosts\s+CampusWorkPost\[\]/);
    expect(model('User')).toMatch(
      /campusWorkPosts\s+CampusWorkPost\[\]\s+@relation\("CampusWorkAuthor"\)/,
    );
  });

  it('contracts retired compatibility fields and the legacy job model', () => {
    expect(model('Resource')).not.toMatch(/courseCode\s+String\?/);
    expect(model('Resource')).toMatch(/tags\s+String\[\]\s+@default\(\[\]\)/);
    expect(model('Campus')).not.toMatch(/allowedEmailDomain\s+String\?/);
    expect(schema).not.toMatch(/model JobPost\s*\{/);
  });
});

describe('campus-work preset seed contract', () => {
  it('imports and iterates the shared pure preset data', () => {
    expect(seedSource).toMatch(
      /import \{[\s\S]*presetTagDefaults,[\s\S]*\} from ['"]\.\/default-content-data['"]/,
    );
    expect(seedSource).not.toMatch(/const presetTagDefaults\s*=/);
    expect(seedSource).toMatch(/for \(const preset of presetTagDefaults\)/);
    expect(seedSource).toMatch(/db\.tagDefinition\.upsert\(\{/);
    expect(seedSource).toMatch(
      /where:\s*\{\s*campusId_scope_slug:\s*\{\s*campusId:\s*campus\.id,\s*scope:\s*preset\.scope,\s*slug:\s*preset\.slug/,
    );
    expect(seedSource).toMatch(
      /update:\s*\{[\s\S]*?isActive:\s*true,[\s\S]*?isPreset:\s*true,[\s\S]*?label:\s*preset\.label/,
    );
    expect(seedSource).toMatch(
      /create:\s*\{[\s\S]*?campusId:\s*campus\.id,[\s\S]*?isActive:\s*true,[\s\S]*?isPreset:\s*true,[\s\S]*?label:\s*preset\.label,[\s\S]*?scope:\s*preset\.scope,[\s\S]*?slug:\s*preset\.slug/,
    );
  });
});
