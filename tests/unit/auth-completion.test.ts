import { describe, expect, it } from 'vitest';

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
});
