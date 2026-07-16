import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resendVerificationEmail } = vi.hoisted(() => ({
  resendVerificationEmail: vi.fn(async () => undefined),
}));

vi.mock('@/lib/auth/auth-service', () => ({ resendVerificationEmail }));

import { POST } from '@/app/api/auth/resend-verification/route';

function request(email: string) {
  return new Request('http://localhost/api/auth/resend-verification', {
    body: JSON.stringify({ email }),
    headers: {
      'content-type': 'application/json',
      origin: new URL(process.env.APP_URL ?? 'http://localhost:3000').origin,
      'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    },
    method: 'POST',
  });
}

describe('resend verification route', () => {
  beforeEach(() => {
    resendVerificationEmail.mockReset();
    resendVerificationEmail.mockResolvedValue(undefined);
  });

  it('returns the same Chinese acknowledgement for a valid request', async () => {
    const response = await POST(request('member@qq.com'));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toStrictEqual({
      message: '如果该邮箱正在等待验证，请查看收件箱中的最新验证邮件。',
    });
  });

  it('logs a sanitized delivery failure and does not claim success', async () => {
    resendVerificationEmail.mockRejectedValue(
      new Error('SMTP secret and recipient must not be logged'),
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(request('member2@qq.com'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toStrictEqual({
      message: '暂时无法发送验证邮件，请稍后重试。',
    });
    expect(error).toHaveBeenCalledWith('Verification email delivery failed.', {
      errorName: 'Error',
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('SMTP secret');
    expect(JSON.stringify(error.mock.calls)).not.toContain('member2@qq.com');
    error.mockRestore();
  });
});
