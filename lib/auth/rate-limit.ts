export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(key: string): RateLimitResult;
}

export interface InMemoryRateLimiterOptions {
  limit: number;
  now?: () => number;
  windowMs: number;
}

/**
 * Process-local protection for development and single-instance deployments.
 * Multi-instance deployments must replace this injected limiter with a shared
 * implementation (for example, Redis) before treating it as an enforcement
 * boundary.
 */
export function createInMemoryRateLimiter({
  limit,
  now = Date.now,
  windowMs,
}: InMemoryRateLimiterOptions): RateLimiter {
  const attemptsByKey = new Map<string, number[]>();

  return {
    consume(key) {
      const currentTime = now();
      const cutoff = currentTime - windowMs;
      const recentAttempts = (attemptsByKey.get(key) ?? []).filter(
        (attemptedAt) => attemptedAt > cutoff,
      );

      if (recentAttempts.length >= limit) {
        attemptsByKey.set(key, recentAttempts);
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((recentAttempts[0] + windowMs - currentTime) / 1_000),
        );
        return { allowed: false, retryAfterSeconds };
      }

      recentAttempts.push(currentTime);
      attemptsByKey.set(key, recentAttempts);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
