import { describe, expect, it } from 'vitest';

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
