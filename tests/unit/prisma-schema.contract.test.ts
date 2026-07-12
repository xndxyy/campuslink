import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)),
  'utf8',
);

describe('Prisma schema contract', () => {
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
  });
});
