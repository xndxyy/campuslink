import { describe, expect, it } from 'vitest';

import { verifyEmailToken } from '@/lib/auth/auth-service';
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

  it('uses a normalized e-mail limiter key before consuming a known verification token', async () => {
    const limiterKeys: string[] = [];
    const transaction = {
      user: {
        findUnique: async () => ({
          id: 'pending-user',
          status: 'PENDING_VERIFICATION',
        }),
        update: async () => undefined,
      },
      verificationToken: {
        delete: async () => undefined,
        findUnique: async () => ({
          expires: new Date('2030-01-01T00:00:00.000Z'),
          identifier: ' Student@CampusLink.edu ',
        }),
      },
    };
    const db = {
      $transaction: async (
        callback: (value: typeof transaction) => Promise<boolean>,
      ) => callback(transaction),
    };
    const limiter = {
      consume(key: string) {
        limiterKeys.push(key);
        return { allowed: false, retryAfterSeconds: 60 };
      },
    };

    await expect(
      verifyEmailToken('known-token', {
        db: db as never,
        rateLimiter: limiter,
      }),
    ).resolves.toBe(false);
    expect(limiterKeys).toEqual(['email:student@campuslink.edu']);
  });
});
