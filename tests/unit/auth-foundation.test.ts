import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { signUpWithPassword } from '@/lib/auth/auth-service';
import { resendVerificationSchema, signUpSchema } from '@/lib/auth/credentials';
import { isPasswordValid } from '@/lib/auth/password';
import { isRoleAllowed } from '@/lib/auth/permissions';
import { getDefaultCampusSlug } from '@/lib/config';

const signUpPageSource = readFileSync(
  fileURLToPath(new URL('../../app/auth/sign-up/page.tsx', import.meta.url)),
  'utf8',
);

describe('authentication foundation', () => {
  it('accepts a password with at least 12 characters and every required character class', () => {
    expect(isPasswordValid('SafeCampus!42')).toBe(true);
  });

  it('rejects a password missing a required character class', () => {
    expect(isPasswordValid('safecampuspassword')).toBe(false);
  });

  it('allows a moderator through the moderator role guard', () => {
    expect(isRoleAllowed('MODERATOR', ['MODERATOR', 'ADMIN'])).toBe(true);
  });

  it('does not allow a student through the moderator role guard', () => {
    expect(isRoleAllowed('STUDENT', ['MODERATOR', 'ADMIN'])).toBe(false);
  });

  it('uses a trimmed configured default campus slug or the seed slug', () => {
    expect(getDefaultCampusSlug({ DEFAULT_CAMPUS_SLUG: '  community  ' })).toBe(
      'community',
    );
    expect(getDefaultCampusSlug({})).toBe('campuslink');
  });

  it('normalizes any valid email address before open registration', () => {
    const result = signUpSchema.safeParse({
      email: '  Member@QQ.com ',
      name: 'Community Member',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('member@qq.com');
    }
  });

  it('accepts a valid public email when resending verification', () => {
    expect(
      resendVerificationSchema.safeParse({ email: '  Member@QQ.com ' }),
    ).toMatchObject({
      data: { email: 'member@qq.com' },
      success: true,
    });
  });

  it('continues to reject malformed email addresses', () => {
    expect(
      signUpSchema.safeParse({
        email: 'not-an-email',
        name: 'Community Member',
      }).success,
    ).toBe(false);
    expect(
      resendVerificationSchema.safeParse({ email: 'not-an-email' }).success,
    ).toBe(false);
  });

  it('presents sign-up as open to any valid email address', () => {
    expect(signUpPageSource).toContain('Email address');
    expect(signUpPageSource).not.toMatch(/campus e-mail/i);
  });

  it('creates a pending user in the active default campus', async () => {
    const createUser = vi.fn(async () => ({ id: 'user_1' }));
    const createToken = vi.fn(async () => ({ tokenHash: 'hash' }));
    const transaction = {
      user: {
        create: createUser,
        findUnique: vi.fn(async () => null),
      },
      verificationToken: {
        create: createToken,
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const findFirst = vi.fn(async () => ({
      id: 'campus_1',
      isActive: true,
      slug: 'campuslink',
    }));
    const db = {
      $transaction: async (
        operation: (value: typeof transaction) => Promise<boolean>,
      ) => operation(transaction),
      campus: { findFirst },
    };
    const mailer = { sendVerificationEmail: vi.fn(async () => undefined) };

    await signUpWithPassword(
      { email: 'member@qq.com', name: 'Community Member' },
      { db: db as never, mailer },
    );

    expect(findFirst).toHaveBeenCalledWith({
      where: { isActive: true, slug: 'campuslink' },
    });
    expect(createUser).toHaveBeenCalledWith({
      data: {
        campusId: 'campus_1',
        email: 'member@qq.com',
        name: 'Community Member',
        status: 'PENDING_VERIFICATION',
      },
    });
    expect(createToken).toHaveBeenCalledOnce();
    expect(mailer.sendVerificationEmail).toHaveBeenCalledOnce();
  });

  it('has no registration side effects when the active default campus is missing', async () => {
    const transaction = vi.fn();
    const mailer = { sendVerificationEmail: vi.fn() };
    const db = {
      $transaction: transaction,
      campus: { findFirst: vi.fn(async () => null) },
    };

    await expect(
      signUpWithPassword(
        { email: 'member@qq.com', name: 'Community Member' },
        { db: db as never, mailer },
      ),
    ).resolves.toBeUndefined();
    expect(transaction).not.toHaveBeenCalled();
    expect(mailer.sendVerificationEmail).not.toHaveBeenCalled();
  });
});
