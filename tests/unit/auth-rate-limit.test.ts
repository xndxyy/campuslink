import { describe, expect, it } from 'vitest';

import { createInMemoryRateLimiter } from '@/lib/auth/rate-limit';

describe('in-memory authentication rate limiting', () => {
  it('rejects requests beyond the configured window limit and permits them after the window', () => {
    let now = 1_000;
    const limiter = createInMemoryRateLimiter({
      limit: 2,
      now: () => now,
      windowMs: 60_000,
    });

    expect(limiter.consume('client')).toMatchObject({ allowed: true });
    expect(limiter.consume('client')).toMatchObject({ allowed: true });
    expect(limiter.consume('client')).toMatchObject({ allowed: false });

    now += 60_001;

    expect(limiter.consume('client')).toMatchObject({ allowed: true });
  });
});
