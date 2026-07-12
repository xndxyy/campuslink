import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('release contract', () => {
  it('uses a Next 16 proxy with nonce propagation and sensitive no-store coverage', () => {
    expect(existsSync(resolve(root, 'proxy.ts'))).toBe(true);
    const proxy = read('proxy.ts');
    expect(proxy).toContain("requestHeaders.set('x-nonce'");
    expect(proxy).toMatch(
      /response\.headers\.set\(\s*'Content-Security-Policy'/,
    );
    expect(proxy).toContain('private, no-store');
    expect(proxy).not.toContain('middleware');
    expect(read('next.config.ts')).toContain(
      "allowedDevOrigins: ['127.0.0.1']",
    );
  });

  it('routes every JSON mutation through the bounded reader', () => {
    const paths = [
      'lib/domain/content-routes.ts',
      'lib/domain/content-action-route.ts',
      'lib/domain/engagement-routes.ts',
      'app/api/uploads/intent/route.ts',
      'app/api/uploads/complete/route.ts',
      'app/api/auth/sign-in/route.ts',
      'app/api/auth/sign-up/route.ts',
      'app/api/auth/verify/route.ts',
      'app/api/auth/resend-verification/route.ts',
      'app/api/admin/moderation/route.ts',
      'app/api/admin/reports/route.ts',
      'app/api/admin/settings/route.ts',
      'app/api/admin/users/route.ts',
    ];
    for (const path of paths) {
      expect(read(path), path).not.toContain('request.json()');
      expect(read(path), path).not.toContain('.catch(() => null)');
    }
  });

  it('defines CI, release verification, operations documentation, and safe env examples', () => {
    for (const path of [
      '.github/workflows/ci.yml',
      'scripts/verify-release.ts',
      'scripts/provision-e2e.ts',
      'docs/deployment.md',
      'docs/operations.md',
      'docs/security.md',
    ]) {
      expect(existsSync(resolve(root, path)), path).toBe(true);
    }
    const workflow = read('.github/workflows/ci.yml');
    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('npm run test:integration');
    expect(workflow).toContain('npm run test:e2e');
    expect(workflow).toContain('playwright-report');
    expect(workflow).not.toContain('ALLOW_SKIPPED_INTEGRATION');
    expect(workflow).not.toContain('ALLOW_SKIPPED_E2E');
    expect(read('package.json')).not.toContain('--pass-with-no-tests');
    expect(read('vitest.integration.config.ts')).not.toContain(
      'passWithNoTests',
    );
    const releaseScript = read('scripts/verify-release.ts');
    expect(releaseScript).toContain('process.env.npm_execpath');
    expect(releaseScript).toContain('spawnSync(process.execPath');
    expect(releaseScript).not.toContain('shell:');
  });

  it('ships a real, authenticated malware scan callback and database status', () => {
    expect(
      existsSync(
        resolve(root, 'app/api/internal/uploads/scan-result/route.ts'),
      ),
    ).toBe(true);
    const schema = read('prisma/schema.prisma');
    expect(schema).toContain('enum AssetScanStatus');
    expect(schema).toMatch(/model Asset[\s\S]*scanStatus\s+AssetScanStatus/);
    expect(read('lib/storage/scanning.ts')).toContain('recordAssetScanResult');
    expect(read('lib/security/runtime-config.ts')).toContain(
      'UPLOAD_SCANNER_CALLBACK_SECRET',
    );
    expect(
      read(
        'prisma/migrations/20260713013000_add_asset_malware_scan/migration.sql',
      ),
    ).toMatch(/UPDATE "Resource"[\s\S]*status" = 'HIDDEN'/);
  });
});
