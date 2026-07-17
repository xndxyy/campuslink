import { createHash } from 'node:crypto';

import { expect, test as base, type Page } from '@playwright/test';
import { Pool } from 'pg';

import { assertSafeDestructiveE2eEnvironment } from './e2e-database-safety';
import { shouldRunSharedAccountE2e } from './e2e-environment';

function testClientAddress(testId: string) {
  const groups = createHash('sha256')
    .update(testId)
    .digest('hex')
    .slice(0, 28)
    .match(/.{4}/g);
  if (!groups) throw new Error('Unable to derive the E2E client address.');
  return `fd00:${groups.join(':')}`;
}

export const test = base.extend<{
  rateLimitIdentity: void;
  resetRateLimitBuckets: void;
}>({
  rateLimitIdentity: [
    async ({ page }, use, testInfo) => {
      await page.setExtraHTTPHeaders({
        'x-forwarded-for': testClientAddress(testInfo.testId),
      });
      await use();
    },
    { auto: true },
  ],
  resetRateLimitBuckets: [
    async ({}, use) => {
      if (shouldRunSharedAccountE2e(process.env)) {
        assertSafeDestructiveE2eEnvironment(process.env);
        const db = new Pool({ connectionString: process.env.DATABASE_URL });
        try {
          await db.query('DELETE FROM "RateLimitBucket"');
        } finally {
          await db.end();
        }
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect, type Page };
