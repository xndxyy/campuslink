import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

function runtimeSource() {
  const files: string[] = [];
  const collect = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) collect(path);
      else if (/\.(?:ts|tsx)$/.test(entry)) files.push(path);
    }
  };
  for (const directory of ['app', 'components', 'lib']) {
    collect(resolve(root, directory));
  }
  files.push(resolve(root, 'prisma/seed.ts'));
  files.push(resolve(root, 'scripts/provision-e2e.ts'));
  return files.map((path) => readFileSync(path, 'utf8')).join('\n');
}

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
      'docs/DELIVERY.md',
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

  it('documents the production deployment order and read-only governance checks', () => {
    const delivery = read('docs/DELIVERY.md');
    const orderedCommands = [
      'npm ci',
      'npm run db:generate',
      'npm run build',
      'npm run db:migrate:deploy',
      'npm prune --omit=dev',
      'systemctl restart campuslink',
      'systemctl restart campuslink-upload-cleanup.timer',
    ];
    let previous = -1;
    for (const command of orderedCommands) {
      const index = delivery.indexOf(command);
      expect(index, command).toBeGreaterThan(previous);
      previous = index;
    }
    expect(delivery).toContain('不得运行 `prisma db seed`');
    expect(delivery).toContain('prisma migrate status');
    expect(delivery).toMatch(/GROUP BY\s+scope/i);
    expect(delivery).toMatch(/"BlockedWord"[\s\S]*enabled\s*=\s*true/i);
    expect(delivery).toContain('systemctl is-active campuslink');
    expect(delivery).toContain(
      'systemctl is-active campuslink-upload-cleanup.timer',
    );
    expect(delivery).toContain('https://swuerlink.top/');
    expect(delivery).toContain('https://swuerlink.top/auth/sign-in');
  });

  it('documents open registration against the active default CampusLink community', () => {
    const envExample = read('.env.example');
    const guide = read('docs/CAMPUSLINK_PROJECT_DELIVERY_GUIDE_ZH.md');

    expect(envExample).toMatch(/^DEFAULT_CAMPUS_SLUG=campuslink$/m);
    expect(guide).toContain('DEFAULT_CAMPUS_SLUG=campuslink');
    expect(guide).not.toContain('CAMPUS_EMAIL_DOMAIN');
    expect(guide).toContain('21 个 Prisma 迁移');
    expect(guide).not.toMatch(/(?:18|19|20)\s*个[^\n]*迁移/);
    expect(guide).toMatch(
      /'campuslink',\s*\n\s*'西大同学 CampusLink',\s*\n\s*true,/,
    );
    expect(guide).toMatch(/'defaultCampusSlug',\s*'campuslink'/);
    expect(guide).not.toMatch(
      /allowedEmailDomain[^\n]*(?:旧|遗留)[^\n]*(?:不参与|不是)[^\n]*注册准入/,
    );
    expect(guide).toMatch(
      /20260713220000_contract_legacy_content[^\n]*永久删除[^\n]*allowedEmailDomain/,
    );
    expect(guide).not.toMatch(/允许注册的邮箱域名|校园邮箱域名变更/);
  });

  it('removes legacy content readers and writers while preserving HTTP redirects', () => {
    const source = runtimeSource();
    expect(source).not.toMatch(/\bcourseCode\b/);
    expect(source).not.toMatch(/\ballowedEmailDomain\b/);
    expect(source).not.toMatch(/\bjobPost\b/);
    expect(source).not.toMatch(/\b(?:create|update)Job(?:Post|Schema|Input)\b/);

    expect(read('app/jobs/page.tsx')).toContain('permanentRedirect');
    expect(read('app/jobs/[id]/page.tsx')).toContain('permanentRedirect');
    for (const path of [
      'app/api/jobs/route.ts',
      'app/api/jobs/[id]/route.ts',
    ]) {
      const route = read(path);
      expect(route, path).toContain('NextResponse.redirect');
      expect(route, path).not.toMatch(/handleCreate|handleContentAction/);
    }
  });

  it('documents every Phase 5 secret and live AI fixture variable', () => {
    const envExample = read('.env.example');
    const guide = read('docs/CAMPUSLINK_PROJECT_DELIVERY_GUIDE_ZH.md');
    for (const variable of [
      'DEFAULT_CAMPUS_SLUG',
      'AI_ALLOWED_HOSTS',
      'AI_CONFIG_ENCRYPTION_KEY_V1',
      'ANONYMOUS_IDENTITY_KEY_V1',
      'ANONYMOUS_FINGERPRINT_KEY',
      'UPLOAD_CLEANUP_SECRET',
      'UPLOAD_SCANNER_CALLBACK_SECRET',
      'E2E_AI_BASE_URL',
      'E2E_AI_FAILURE_BASE_URL',
      'E2E_AI_API_KEY',
      'E2E_AI_MODEL',
    ]) {
      expect(envExample, variable).toContain(variable);
    }
    for (const evidence of [
      '200af9014448bffa4974f3a9b1aedded72ce2caf',
      'community-expansion-phase-5',
      'AI_CHECK_SKIPPED',
      'AI_ALLOWED_HOSTS',
      'AI_CONFIG_ENCRYPTION_KEY_V1',
      'ANONYMOUS_IDENTITY_KEY_V1',
      'ANONYMOUS_FINGERPRINT_KEY',
    ]) {
      expect(guide, evidence).toContain(evidence);
    }
    expect(guide).toMatch(/live Integration\/E2E[^\n]*`UNKNOWN`/);
  });

  it('makes the release verifier require Phase 5 migration and E2E evidence', () => {
    const releaseScript = read('scripts/verify-release.ts');
    for (const path of [
      'prisma/migrations/20260713220000_contract_legacy_content/migration.sql',
      'prisma/migrations/20260717100000_seed_publishing_defaults/migration.sql',
      'prisma/migrations/20260717110000_add_owner_deletion_requests/migration.sql',
      'tests/e2e/authorization.spec.ts',
      'tests/e2e/moderation-ai.spec.ts',
      'tests/e2e/publishing-governance.spec.ts',
    ]) {
      expect(releaseScript, path).toContain(path);
    }
    for (const command of [
      "['run', 'db:migrate:deploy']",
      "['run', 'test:integration']",
      "['run', 'e2e:provision']",
      "['run', 'test:e2e']",
      "['run', 'build']",
    ]) {
      expect(releaseScript, command).toContain(command);
    }
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
