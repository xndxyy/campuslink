import { describe, expect, it, vi } from 'vitest';

import {
  resendVerificationEmail,
  verifyEmailToken,
} from '@/lib/auth/auth-service';
import {
  signUpSchema,
  verificationCompletionSchema,
} from '@/lib/auth/credentials';

describe('link-holder credential completion', () => {
  it('creates a pending registration from only identity data', () => {
    expect(
      signUpSchema.safeParse({
        email: 'student@campuslink.edu',
        name: 'Student One',
      }).success,
    ).toBe(true);
  });

  it('requires the verification link holder to choose and confirm a password', () => {
    expect(
      verificationCompletionSchema.safeParse({
        confirmPassword: 'DifferentCampus!42',
        password: 'SafeCampus!42',
        token: 'verification-token',
      }).success,
    ).toBe(false);
  });

  it('conditionally consumes one token so concurrent completions activate only once', async () => {
    let tokenAvailable = true;
    let updates = 0;
    const transaction = {
      user: {
        updateMany: async () => {
          updates += 1;
          return { count: 1 };
        },
      },
      verificationToken: {
        deleteMany: async () => {
          if (!tokenAvailable) {
            return { count: 0 };
          }
          tokenAvailable = false;
          return { count: 1 };
        },
        findUnique: async () => ({
          expires: new Date('2030-01-01T00:00:00.000Z'),
          identifier: 'student@campuslink.edu',
        }),
      },
    };
    const db = {
      $transaction: async (
        callback: (value: typeof transaction) => Promise<boolean>,
      ) => callback(transaction),
    };

    const [first, second] = await Promise.all([
      verifyEmailToken('known-token', 'SafeCampus!42', { db: db as never }),
      verifyEmailToken('known-token', 'SafeCampus!42', { db: db as never }),
    ]);

    expect([first, second].sort()).toEqual([false, true]);
    expect(updates).toBe(1);
  });

  it('replaces a pending address token again after delivery fails', async () => {
    let createdTokens = 0;
    const transaction = {
      $queryRawUnsafe: vi.fn(async () => [{ id: 'user_1' }]),
      user: {
        findUnique: async () => ({
          passwordHash: null,
          status: 'PENDING_VERIFICATION',
        }),
      },
      verificationToken: {
        create: async () => {
          createdTokens += 1;
        },
        deleteMany: async () => ({ count: 1 }),
      },
    };
    const db = {
      $transaction: async (
        callback: (value: typeof transaction) => Promise<boolean>,
      ) => callback(transaction),
    };
    const failedMailer = {
      sendVerificationEmail: async () => {
        throw new Error('SMTP unavailable');
      },
    };

    await expect(
      resendVerificationEmail('student@campuslink.edu', {
        db: db as never,
        mailer: failedMailer,
      }),
    ).rejects.toThrow('SMTP unavailable');
    await expect(
      resendVerificationEmail('student@campuslink.edu', {
        db: db as never,
        mailer: failedMailer,
      }),
    ).rejects.toThrow('SMTP unavailable');

    expect(createdTokens).toBe(2);
  });

  it('normalizes the address and invalidates the previous token when resending', async () => {
    const tokens = new Map<
      string,
      { expires: Date; identifier: string; tokenHash: string }
    >();
    const transaction = {
      $queryRawUnsafe: vi.fn(async () => [{ id: 'user_1' }]),
      user: {
        findUnique: vi.fn(async () => ({
          passwordHash: null,
          status: 'PENDING_VERIFICATION',
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      verificationToken: {
        create: vi.fn(async ({ data }) => {
          tokens.set(data.tokenHash, data);
          return data;
        }),
        deleteMany: vi.fn(async ({ where }) => {
          if (where.identifier) {
            let count = 0;
            for (const [hash, record] of tokens) {
              if (record.identifier === where.identifier) {
                tokens.delete(hash);
                count += 1;
              }
            }
            return { count };
          }
          if (where.tokenHash && tokens.delete(where.tokenHash)) {
            return { count: 1 };
          }
          return { count: 0 };
        }),
        findUnique: vi.fn(
          async ({ where }) => tokens.get(where.tokenHash) ?? null,
        ),
      },
    };
    const db = {
      $transaction: async <T>(
        callback: (value: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    };
    const urls: string[] = [];
    const mailer = {
      sendVerificationEmail: vi.fn(async ({ verificationUrl }) => {
        urls.push(verificationUrl);
      }),
    };

    await resendVerificationEmail('  Member@QQ.com ', {
      appUrl: 'https://swuerlink.top',
      db: db as never,
      mailer,
    });
    await resendVerificationEmail('member@qq.com', {
      appUrl: 'https://swuerlink.top',
      db: db as never,
      mailer,
    });

    const firstToken = new URL(urls[0]!).searchParams.get('token')!;
    const secondToken = new URL(urls[1]!).searchParams.get('token')!;
    await expect(
      verifyEmailToken(firstToken, 'SafeCampus!42', { db: db as never }),
    ).resolves.toBe(false);
    await expect(
      verifyEmailToken(secondToken, 'SafeCampus!42', { db: db as never }),
    ).resolves.toBe(true);
    expect(transaction.user.findUnique).toHaveBeenCalledWith({
      select: { passwordHash: true, status: true },
      where: { email: 'member@qq.com' },
    });
    expect(transaction.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      'member@qq.com',
    );
    expect(
      transaction.$queryRawUnsafe.mock.invocationCallOrder[0],
    ).toBeLessThan(
      transaction.verificationToken.deleteMany.mock.invocationCallOrder[0]!,
    );
  });
});
