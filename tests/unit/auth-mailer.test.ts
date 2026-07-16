import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(async () => ({ messageId: 'message_1' })),
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: mocks.createTransport },
}));

import {
  createEnvironmentMailer,
  getSmtpConfiguration,
} from '@/lib/auth/mailer';

afterEach(() => {
  vi.unstubAllEnvs();
  mocks.createTransport.mockReset();
  mocks.sendMail.mockClear();
});

describe('verification mail transport configuration', () => {
  it('requires complete authenticated TLS SMTP configuration in production', () => {
    expect(() =>
      getSmtpConfiguration({
        environment: 'production',
        host: 'smtp.example',
        password: '',
        port: '587',
        user: 'mailer',
      }),
    ).toThrow('SMTP_USER and SMTP_PASSWORD must be configured together');
  });

  it('uses TLS for submission ports and implicit TLS for port 465', () => {
    expect(
      getSmtpConfiguration({
        environment: 'production',
        host: 'smtp.example',
        password: 'secret',
        port: '587',
        user: 'mailer',
      }),
    ).toMatchObject({ requireTLS: true, secure: false });
    expect(
      getSmtpConfiguration({
        environment: 'production',
        host: 'smtp.example',
        password: 'secret',
        port: '465',
        user: 'mailer',
      }),
    ).toMatchObject({ requireTLS: false, secure: true });
  });

  it('sends a Chinese verification message with the canonical link', async () => {
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SMTP_HOST', 'smtp.example.test');
    vi.stubEnv('SMTP_PORT', '587');
    vi.stubEnv('SMTP_USER', 'resend');
    vi.stubEnv('SMTP_PASSWORD', 'test-secret');
    vi.stubEnv('MAIL_FROM', 'CampusLink <noreply@example.test>');
    const verificationUrl =
      'https://swuerlink.top/auth/verify?token=verification-token';

    await createEnvironmentMailer().sendVerificationEmail({
      recipient: 'member@qq.com',
      verificationUrl,
    });

    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining(verificationUrl),
        subject: '验证你的 CampusLink 邮箱',
        text: expect.stringContaining('完成邮箱验证'),
        to: 'member@qq.com',
      }),
    );
  });
});
