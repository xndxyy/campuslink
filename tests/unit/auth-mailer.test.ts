import { describe, expect, it } from 'vitest';

import { getSmtpConfiguration } from '@/lib/auth/mailer';

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
});
