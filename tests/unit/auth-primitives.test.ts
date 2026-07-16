import { describe, expect, it } from 'vitest';

import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  signInSchema,
  signUpSchema,
  verificationCompletionSchema,
  verifyPassword,
} from '@/lib/auth/credentials';

describe('credential primitives', () => {
  it('normalizes a valid campus e-mail on sign-up', () => {
    const result = signUpSchema.safeParse({
      email: '  Student@CampusLink.edu ',
      name: 'Student One',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('student@campuslink.edu');
    }
  });

  it('accepts a valid e-mail outside the legacy campus domain', () => {
    const result = signUpSchema.safeParse({
      email: 'member@qq.com',
      name: 'Community Member',
    });

    expect(result.success).toBe(true);
  });

  it('requires a strong password at the verification completion boundary', () => {
    const result = verificationCompletionSchema.safeParse({
      confirmPassword: 'only-lowercase',
      password: 'only-lowercase',
      token: 'verification-token',
    });

    expect(result.success).toBe(false);
  });

  it('rejects verification completion when password confirmation differs', () => {
    const result = verificationCompletionSchema.safeParse({
      confirmPassword: 'DifferentCampus!42',
      password: 'SafeCampus!42',
      token: 'verification-token',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          message: '两次输入的密码不一致。',
          path: ['confirmPassword'],
        }),
      );
    }
  });

  it('normalizes sign-in e-mail without applying the campus sign-up domain restriction', () => {
    const result = signInSchema.safeParse({
      email: '  Student@Other.Example ',
      password: 'any submitted password',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('student@other.example');
    }
  });

  it('hashes and verifies passwords without retaining the submitted password', async () => {
    const password = 'SafeCampus!42';
    const passwordHash = await hashPassword(password);

    expect(passwordHash).not.toBe(password);
    expect(passwordHash).toMatch(/^\$2[aby]\$/);
    await expect(verifyPassword(password, passwordHash)).resolves.toBe(true);
    await expect(
      verifyPassword('WrongPassword!42', passwordHash),
    ).resolves.toBe(false);
  });

  it('derives a deterministic SHA-256 hash for a newly generated opaque token', () => {
    const token = createOpaqueToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashOpaqueToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
  });
});
