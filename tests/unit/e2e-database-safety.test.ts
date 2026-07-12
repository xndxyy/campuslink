import { describe, expect, it } from 'vitest';

import { assertSafeDestructiveE2eEnvironment } from '@/tests/helpers/e2e-database-safety';

const safe = {
  ALLOW_DESTRUCTIVE_E2E: 'true',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/campuslink_e2e',
  NODE_ENV: 'test',
};

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
});
