import nodemailer from 'nodemailer';

export interface VerificationEmail {
  recipient: string;
  verificationUrl: string;
}

export interface VerificationMailer {
  sendVerificationEmail(email: VerificationEmail): Promise<void>;
}

export interface SmtpConfigurationInput {
  environment: 'development' | 'production' | 'test';
  host?: string;
  password?: string;
  port?: string;
  user?: string;
}

export interface SmtpConfiguration {
  auth: { pass: string; user: string };
  host: string;
  port: number;
  requireTLS: boolean;
  secure: boolean;
}

function getSmtpPort(portValue = '587'): number {
  const port = Number(portValue);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('SMTP_PORT must be a valid TCP port.');
  }

  return port;
}

export function getSmtpConfiguration(
  input: SmtpConfigurationInput,
): SmtpConfiguration | null {
  const host = input.host?.trim();
  const user = input.user?.trim();
  const password = input.password;

  if (!host) {
    if (input.environment === 'production') {
      throw new Error('SMTP_HOST is required in production.');
    }
    return null;
  }

  if (!user || !password) {
    throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together.');
  }

  const port = getSmtpPort(input.port ?? '587');
  return {
    auth: { pass: password, user },
    host,
    port,
    requireTLS: port !== 465,
    secure: port === 465,
  };
}

export function createEnvironmentMailer(): VerificationMailer {
  return {
    async sendVerificationEmail({ recipient, verificationUrl }) {
      const environment =
        process.env.NODE_ENV === 'production' ? 'production' : 'development';
      const configuration = getSmtpConfiguration({
        environment,
        host: process.env.SMTP_HOST,
        password: process.env.SMTP_PASSWORD,
        port: process.env.SMTP_PORT,
        user: process.env.SMTP_USER,
      });

      if (!configuration) {
        console.info(`Development verification e-mail: ${verificationUrl}`);
        return;
      }

      const from = process.env.MAIL_FROM?.trim();
      if (environment === 'production' && !from) {
        throw new Error('MAIL_FROM is required in production.');
      }

      const transport = nodemailer.createTransport(configuration);
      const escapedUrl = verificationUrl
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');

      await transport.sendMail({
        from: from ?? 'CampusLink <noreply@localhost>',
        html: [
          '<p>你好，</p>',
          '<p>请点击下方按钮完成邮箱验证，并为 CampusLink 账号设置密码。</p>',
          `<p><a href="${escapedUrl}">验证邮箱</a></p>`,
          '<p>链接将在 24 小时后失效。若你多次申请验证，请使用最新一封邮件中的链接。</p>',
          `<p>如果按钮无法打开，请在浏览器中访问：${escapedUrl}</p>`,
          '<p>如果不是你本人发起的操作，可以忽略这封邮件。</p>',
        ].join(''),
        subject: '验证你的 CampusLink 邮箱',
        text: [
          '请完成邮箱验证并设置 CampusLink 账号密码。',
          `验证链接：${verificationUrl}`,
          '链接将在 24 小时后失效。若你多次申请验证，请使用最新一封邮件中的链接。',
          '如果不是你本人发起的操作，可以忽略这封邮件。',
        ].join('\n'),
        to: recipient,
      });
    },
  };
}
