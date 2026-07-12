import nodemailer from 'nodemailer';

export interface VerificationEmail {
  recipient: string;
  verificationUrl: string;
}

export interface VerificationMailer {
  sendVerificationEmail(email: VerificationEmail): Promise<void>;
}

function getSmtpPort(): number {
  const port = Number(process.env.SMTP_PORT ?? '587');

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('SMTP_PORT must be a valid TCP port.');
  }

  return port;
}

export function createEnvironmentMailer(): VerificationMailer {
  return {
    async sendVerificationEmail({ recipient, verificationUrl }) {
      const host = process.env.SMTP_HOST?.trim();

      if (!host) {
        // Deliberately omit recipient and link/token from development output.
        console.info(
          'Verification e-mail was not sent because SMTP is not configured.',
        );
        return;
      }

      const port = getSmtpPort();
      const user = process.env.SMTP_USER;
      const password = process.env.SMTP_PASSWORD;
      const transport = nodemailer.createTransport({
        auth: user && password ? { pass: password, user } : undefined,
        host,
        port,
        secure: port === 465,
      });

      await transport.sendMail({
        from: process.env.MAIL_FROM ?? 'CampusLink <noreply@localhost>',
        html: `<p>Verify your CampusLink e-mail address:</p><p><a href="${verificationUrl}">Verify e-mail</a></p>`,
        subject: 'Verify your CampusLink e-mail address',
        text: `Verify your CampusLink e-mail address: ${verificationUrl}`,
        to: recipient,
      });
    },
  };
}
