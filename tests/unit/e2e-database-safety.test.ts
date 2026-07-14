import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { assertSafeTestDatabase } from '@/tests/helpers/database-safety';
import { assertSafeDestructiveE2eEnvironment } from '@/tests/helpers/e2e-database-safety';
import {
  requiredSharedAccountE2eEnvironment,
  shouldRunSharedAccountE2e,
} from '@/tests/helpers/e2e-environment';

const safe = {
  ALLOW_DESTRUCTIVE_E2E: 'true',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/campuslink_e2e',
  NODE_ENV: 'test',
};
const forumIntegrationSource = readFileSync(
  fileURLToPath(new URL('../integration/forum.test.ts', import.meta.url)),
  'utf8',
);

function completeSharedEnvironment(
  overrides: Record<string, string | undefined> = {},
) {
  return {
    ...Object.fromEntries(
      requiredSharedAccountE2eEnvironment.map((name) => [name, 'configured']),
    ),
    ...safe,
    ...overrides,
  };
}

function shouldRunPublishContentE2e(
  environment: Record<string, string | undefined>,
) {
  const enabled = shouldRunSharedAccountE2e(environment);
  if (enabled) assertSafeDestructiveE2eEnvironment(environment);
  return enabled;
}

describe('destructive E2E database safety', () => {
  it('accepts only explicitly allowed non-production test databases', () => {
    expect(() => assertSafeDestructiveE2eEnvironment(safe)).not.toThrow();
    expect(() =>
      assertSafeDestructiveE2eEnvironment({
        ...safe,
        DATABASE_URL: 'postgresql://user:password@localhost:5432/campus_test',
      }),
    ).not.toThrow();
  });

  it.each([
    [{ ...safe, ALLOW_DESTRUCTIVE_E2E: undefined }, 'ALLOW_DESTRUCTIVE_E2E'],
    [{ ...safe, NODE_ENV: 'production' }, 'forbidden in production'],
    [
      { ...safe, DATABASE_URL: 'postgresql://user:password@localhost/campus' },
      '_e2e or _test',
    ],
    [{ ...safe, DATABASE_URL: 'not-a-url' }, 'valid DATABASE_URL'],
    [{ ...safe, DATABASE_URL: 'mysql://localhost/campus_test' }, 'PostgreSQL'],
  ] as const)('rejects unsafe environment %j', (environment, message) => {
    expect(() => assertSafeDestructiveE2eEnvironment(environment)).toThrow(
      message,
    );
  });

  it.each([
    [
      'missing destructive opt-in',
      { ALLOW_DESTRUCTIVE_E2E: undefined },
      'ALLOW_DESTRUCTIVE_E2E',
    ],
    ['production', { NODE_ENV: 'production' }, 'forbidden in production'],
    [
      'unsafe database name',
      { DATABASE_URL: 'postgresql://user:password@localhost/campuslink' },
      '_e2e or _test',
    ],
  ] as const)(
    'rejects a complete shared E2E environment with %s',
    (_case, overrides, message) => {
      expect(() =>
        shouldRunPublishContentE2e(completeSharedEnvironment(overrides)),
      ).toThrow(message);
    },
  );

  it('runs only when the complete shared environment is destructively safe', () => {
    expect(shouldRunPublishContentE2e(completeSharedEnvironment())).toBe(true);
  });

  it('ordinary-skips an incomplete local shared environment without a skip opt-in', () => {
    expect(
      shouldRunPublishContentE2e({
        DATABASE_URL: safe.DATABASE_URL,
        NODE_ENV: safe.NODE_ENV,
      }),
    ).toBe(false);
  });
});

describe('common test database safety', () => {
  it('accepts isolated PostgreSQL test databases without an E2E opt-in', () => {
    expect(() =>
      assertSafeTestDatabase({
        DATABASE_URL: 'postgresql://user:password@localhost/campuslink_test',
        NODE_ENV: 'test',
      }),
    ).not.toThrow();
    expect(() =>
      assertSafeTestDatabase({
        DATABASE_URL: 'postgres://user:password@localhost/campuslink_e2e',
        NODE_ENV: 'development',
      }),
    ).not.toThrow();
    expect(() =>
      assertSafeTestDatabase({
        DATABASE_URL:
          'postgresql://user:password@localhost/campuslink_test?schema=public',
        NODE_ENV: 'test',
      }),
    ).not.toThrow();
  });

  it.each([
    [
      'production',
      { DATABASE_URL: safe.DATABASE_URL, NODE_ENV: 'production' },
      'forbidden in production',
    ],
    ['missing URL', { NODE_ENV: 'test' }, 'valid DATABASE_URL'],
    [
      'invalid URL',
      { DATABASE_URL: 'not-a-url', NODE_ENV: 'test' },
      'valid DATABASE_URL',
    ],
    [
      'non-PostgreSQL URL',
      { DATABASE_URL: 'mysql://localhost/campuslink_test', NODE_ENV: 'test' },
      'PostgreSQL',
    ],
    [
      'unsafe database name',
      {
        DATABASE_URL: 'postgresql://user:password@localhost/campuslink',
        NODE_ENV: 'test',
      },
      '_e2e or _test',
    ],
    [
      'URL-encoded unsafe database name',
      {
        DATABASE_URL:
          'postgresql://user:password@localhost/campuslink%5Fproduction',
        NODE_ENV: 'test',
      },
      '_e2e or _test',
    ],
    [
      'query-string database suffix spoofing',
      {
        DATABASE_URL:
          'postgresql://user:password@localhost/campuslink?database=campuslink_test',
        NODE_ENV: 'test',
      },
      '_e2e or _test',
    ],
  ] as const)('rejects %s', (_case, environment, message) => {
    expect(() => assertSafeTestDatabase(environment)).toThrow(message);
  });

  it('guards forum integration before client creation or mutation', () => {
    const setup = forumIntegrationSource.slice(
      forumIntegrationSource.indexOf('beforeAll(async () => {'),
      forumIntegrationSource.indexOf('afterAll(async () => {'),
    );
    const assertion = setup.indexOf('assertSafeTestDatabase(process.env)');
    const clientCreation = setup.indexOf('createDbClient()');
    const firstMutation = setup.indexOf('db.campus.create');

    expect(assertion).toBeGreaterThan(-1);
    expect(clientCreation).toBeGreaterThan(assertion);
    expect(firstMutation).toBeGreaterThan(clientCreation);
  });
});
