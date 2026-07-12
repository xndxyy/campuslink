import 'server-only';

import { getDb } from '@/lib/db';

import { hashOpaqueToken } from './credentials';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(key: string): Promise<RateLimitResult>;
}

export interface InMemoryRateLimiterOptions {
  limit: number;
  maxEntries?: number;
  now?: () => number;
  windowMs: number;
}

interface RateLimitBucket {
  count: number;
  expiresAt: number;
}

const defaultDevelopmentMaxEntries = 10_000;
const validEmailKey = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9.-]{1,255}$/;

function validatedKey(key: string): string | null {
  if (key.length === 0 || key.length > 384) {
    return null;
  }

  if (key.startsWith('email:')) {
    const email = key.slice('email:'.length);
    return validEmailKey.test(email) ? key : null;
  }

  if (key.startsWith('ip:')) {
    const address = key.slice('ip:'.length);
    return /^[0-9a-fA-F:.]{1,45}$/.test(address) ||
      address === 'direct-request' ||
      address === 'invalid-proxy-address'
      ? key
      : null;
  }

  return null;
}

function retryAfter(expiresAt: number, now: number): number {
  return Math.max(1, Math.ceil((expiresAt - now) / 1_000));
}

/**
 * Development-only fallback. It is deliberately bounded by both TTL and
 * cardinality and must never be treated as cross-process enforcement.
 */
export function createInMemoryRateLimiter({
  limit,
  maxEntries = defaultDevelopmentMaxEntries,
  now = Date.now,
  windowMs,
}: InMemoryRateLimiterOptions): RateLimiter {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Rate-limit limit must be a positive integer.');
  }
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error('Rate-limit maxEntries must be a positive integer.');
  }
  if (!Number.isFinite(windowMs) || windowMs < 1) {
    throw new Error('Rate-limit windowMs must be positive.');
  }

  const bucketsByKey = new Map<string, RateLimitBucket>();

  return {
    async consume(key) {
      const boundedKey = validatedKey(key);
      if (!boundedKey) {
        return { allowed: false, retryAfterSeconds: 60 };
      }

      const currentTime = now();
      for (const [storedKey, bucket] of bucketsByKey) {
        if (bucket.expiresAt <= currentTime) {
          bucketsByKey.delete(storedKey);
        }
      }

      const bucket = bucketsByKey.get(boundedKey);
      if (!bucket) {
        if (bucketsByKey.size >= maxEntries) {
          return { allowed: false, retryAfterSeconds: 60 };
        }
        bucketsByKey.set(boundedKey, {
          count: 1,
          expiresAt: currentTime + windowMs,
        });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (bucket.count >= limit) {
        return {
          allowed: false,
          retryAfterSeconds: retryAfter(bucket.expiresAt, currentTime),
        };
      }

      bucket.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

interface DatabaseRateLimiterOptions {
  db?: ReturnType<typeof getDb>;
  limit: number;
  now?: () => Date;
  windowMs: number;
}

/**
 * Shared PostgreSQL limiter. The conditional UPSERT increments only while a
 * bucket is below its limit, so concurrent application instances cannot both
 * admit the final request. Bucket keys are SHA-256 hashes and expiry cleanup
 * bounds their retention.
 */
export function createDatabaseRateLimiter({
  db = getDb(),
  limit,
  now = () => new Date(),
  windowMs,
}: DatabaseRateLimiterOptions): RateLimiter {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Rate-limit limit must be a positive integer.');
  }
  if (!Number.isFinite(windowMs) || windowMs < 1) {
    throw new Error('Rate-limit windowMs must be positive.');
  }

  return {
    async consume(key) {
      const boundedKey = validatedKey(key);
      if (!boundedKey) {
        return { allowed: false, retryAfterSeconds: 60 };
      }

      const currentTime = now();
      const expiresAt = new Date(currentTime.getTime() + windowMs);
      const keyHash = hashOpaqueToken(boundedKey);

      // TTL retention: no raw key is stored and expired buckets are removed
      // before handling a new request. The index keeps this bounded cleanup
      // inexpensive under normal traffic.
      await db.rateLimitBucket.deleteMany({
        where: { expiresAt: { lte: currentTime } },
      });

      const admitted = await db.$queryRaw<
        Array<{ count: number; expiresAt: Date }>
      >`INSERT INTO "RateLimitBucket" ("keyHash", "windowStartedAt", "count", "expiresAt", "createdAt", "updatedAt")
        VALUES (${keyHash}, ${currentTime}, 1, ${expiresAt}, ${currentTime}, ${currentTime})
        ON CONFLICT ("keyHash") DO UPDATE
        SET "windowStartedAt" = CASE
              WHEN "RateLimitBucket"."expiresAt" <= ${currentTime} THEN ${currentTime}
              ELSE "RateLimitBucket"."windowStartedAt"
            END,
            "count" = CASE
              WHEN "RateLimitBucket"."expiresAt" <= ${currentTime} THEN 1
              ELSE "RateLimitBucket"."count" + 1
            END,
            "expiresAt" = CASE
              WHEN "RateLimitBucket"."expiresAt" <= ${currentTime} THEN ${expiresAt}
              ELSE "RateLimitBucket"."expiresAt"
            END,
            "updatedAt" = ${currentTime}
        WHERE "RateLimitBucket"."expiresAt" <= ${currentTime}
           OR "RateLimitBucket"."count" < ${limit}
        RETURNING "count", "expiresAt"`;

      if (admitted.length > 0) {
        return { allowed: true, retryAfterSeconds: 0 };
      }

      const bucket = await db.rateLimitBucket.findUnique({
        where: { keyHash },
      });
      return {
        allowed: false,
        retryAfterSeconds: retryAfter(
          bucket?.expiresAt.getTime() ?? expiresAt.getTime(),
          currentTime.getTime(),
        ),
      };
    },
  };
}

interface EnvironmentRateLimiterOptions {
  databaseUrl?: string;
  environment?: 'development' | 'production' | 'test';
  limit?: number;
  windowMs?: number;
}

export function createEnvironmentRateLimiter(
  options: EnvironmentRateLimiterOptions = {},
): RateLimiter {
  const environment =
    options.environment ??
    (process.env.NODE_ENV === 'production' ? 'production' : 'development');
  const limit = options.limit ?? 10;
  const windowMs = options.windowMs ?? 15 * 60_000;

  if (environment === 'production') {
    if (!(options.databaseUrl ?? process.env.DATABASE_URL)?.trim()) {
      throw new Error(
        'DATABASE_URL is required for production authentication rate limiting.',
      );
    }
    return createDatabaseRateLimiter({
      limit,
      windowMs,
    });
  }

  return createInMemoryRateLimiter({
    limit,
    windowMs,
  });
}
