import { describe, expect, it } from 'vitest';

import {
  createEnvironmentRateLimiter,
  createInMemoryRateLimiter,
} from '@/lib/auth/rate-limit';

describe('in-memory authentication rate limiting', () => {
  it('rejects requests beyond the configured window limit and permits them after the window', async () => {
    let now = 1_000;
    const limiter = createInMemoryRateLimiter({
      limit: 2,
      now: () => now,
      windowMs: 60_000,
    });

    await expect(limiter.consume('ip:127.0.0.1')).resolves.toMatchObject({
      allowed: true,
    });
    await expect(limiter.consume('ip:127.0.0.1')).resolves.toMatchObject({
      allowed: true,
    });
    await expect(limiter.consume('ip:127.0.0.1')).resolves.toMatchObject({
      allowed: false,
    });

    now += 60_001;

    await expect(limiter.consume('ip:127.0.0.1')).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('bounds development limiter cardinality and rejects invalid attacker keys', async () => {
    const limiter = createInMemoryRateLimiter({
      limit: 2,
      maxEntries: 1,
      windowMs: 60_000,
    });

    await expect(limiter.consume('ip:127.0.0.1')).resolves.toMatchObject({
      allowed: true,
    });
    await expect(limiter.consume('ip:127.0.0.2')).resolves.toMatchObject({
      allowed: false,
    });
    await expect(
      limiter.consume(`ip:${'x'.repeat(500)}`),
    ).resolves.toMatchObject({
      allowed: false,
    });
  });

  it('requires a shared database configuration in production', () => {
    expect(() =>
      createEnvironmentRateLimiter({
        databaseUrl: '',
        environment: 'production',
      }),
    ).toThrow(
      'DATABASE_URL is required for production authentication rate limiting',
    );
  });
});
