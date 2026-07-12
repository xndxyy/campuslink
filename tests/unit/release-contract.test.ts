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
    expect(proxy).toContain("response.headers.set('Content-Security-Policy'");
    expect(proxy).toContain('private, no-store');
    expect(proxy).not.toContain('middleware');
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
  });
});
