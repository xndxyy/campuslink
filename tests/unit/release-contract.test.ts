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

  it('bounds Next build workers for constrained release hosts', () => {
    const config = read('next.config.ts');
    expect(config).toMatch(/experimental:\s*{\s*cpus:\s*2\s*}/);
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
    expect(read('eslint.config.mjs')).toContain("'.worktrees/**'");
    expect(read('vitest.integration.config.ts')).not.toContain(
      'passWithNoTests',
    );
    const releaseScript = read('scripts/verify-release.ts');
    expect(releaseScript.indexOf("['run', 'db:generate']")).toBeLessThan(
      releaseScript.indexOf("['run', 'typecheck']"),
    );
    expect(releaseScript).toContain('process.env.npm_execpath');
    expect(releaseScript).toContain('spawnSync(process.execPath');
    expect(releaseScript).not.toContain('shell:');
  });

  it('documents open registration against the active default CampusLink community', () => {
    const envExample = read('.env.example');
    const guide = read('docs/CAMPUSLINK_PROJECT_DELIVERY_GUIDE_ZH.md');

    expect(envExample).toMatch(/^DEFAULT_CAMPUS_SLUG=campuslink$/m);
    expect(guide).toContain('DEFAULT_CAMPUS_SLUG=campuslink');
    expect(guide).not.toContain('CAMPUS_EMAIL_DOMAIN');
    expect(guide).toContain('19 个 Prisma 迁移');
    expect(guide).not.toMatch(/18\s*个[^\n]*迁移/);
    expect(guide).toMatch(
      /'campuslink',\s*\n\s*'西大同学 CampusLink',\s*\n\s*NULL,/,
    );
    expect(guide).toMatch(/'defaultCampusSlug',\s*'campuslink'/);
    expect(guide).toMatch(
      /allowedEmailDomain[^\n]*(?:旧|遗留)[^\n]*(?:不参与|不是)[^\n]*注册准入/,
    );
    expect(guide).not.toContain('allowedEmailDomain` 编辑界面');
    expect(guide).not.toMatch(/允许注册的邮箱域名|校园邮箱域名变更/);
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
