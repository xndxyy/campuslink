import { beforeEach, describe, expect, it, vi } from 'vitest';

const { signUpWithPassword } = vi.hoisted(() => ({
  signUpWithPassword: vi.fn(async () => undefined),
}));

vi.mock('@/lib/auth/auth-service', () => ({ signUpWithPassword }));

import { POST } from '@/app/api/auth/sign-up/route';

describe('sign-up route', () => {
  beforeEach(() => {
    signUpWithPassword.mockClear();
  });

  it('validates the identity-only pending registration request', async () => {
    const origin = new URL(process.env.APP_URL ?? 'http://localhost:3000')
      .origin;
    const response = await POST(
      new Request('http://localhost/api/auth/sign-up', {
        body: JSON.stringify({
          email: 'student@campuslink.edu',
        }),
        headers: {
          'content-type': 'application/json',
          origin,
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: '注册信息无效。',
    });
  });

  it('accepts and normalizes a valid public email with the generic response', async () => {
    const origin = new URL(process.env.APP_URL ?? 'http://localhost:3000')
      .origin;
    const response = await POST(
      new Request('http://localhost/api/auth/sign-up', {
        body: JSON.stringify({
          email: '  Member@QQ.com ',
          name: 'Community Member',
        }),
        headers: {
          'content-type': 'application/json',
          origin,
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      message: '如果该邮箱可以注册，请查看收件箱中的验证邮件。',
    });
    expect(signUpWithPassword).toHaveBeenCalledWith({
      email: 'member@qq.com',
      name: 'Community Member',
    });
  });
});
