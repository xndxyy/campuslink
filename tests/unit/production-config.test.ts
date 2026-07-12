import { describe, expect, it } from 'vitest';

import { validateProductionConfig } from '@/lib/security/runtime-config';

const production = {
  NODE_ENV: 'production',
  APP_URL: 'https://campus.example',
  DATABASE_URL:
    'postgresql://user:secret@db.example/campuslink?sslmode=verify-full',
  MAIL_FROM: 'CampusLink <noreply@example.test>',
  S3_ACCESS_KEY_ID: 'access-key',
  S3_BUCKET: 'campuslink-production',
  S3_ENDPOINT: 'https://objects.example.test',
  S3_FORCE_PATH_STYLE: 'false',
  S3_REGION: 'auto',
  S3_SECRET_ACCESS_KEY: 'secret-key',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PASSWORD: 'smtp-secret',
  SMTP_PORT: '587',
  SMTP_USER: 'mailer',
  TRUST_PROXY: 'true',
  UPLOAD_CLEANUP_SECRET: 'c'.repeat(32),
  UPLOAD_SCANNER_CALLBACK_SECRET: 's'.repeat(32),
} satisfies NodeJS.ProcessEnv;

describe('production runtime configuration', () => {
  it('accepts a complete production configuration', () => {
    expect(validateProductionConfig(production)).toMatchObject({
      scannerRequired: true,
      trustedProxy: true,
    });
  });

  it('fails closed when a scanner is required without integration credentials', () => {
    expect(() =>
      validateProductionConfig({
        ...production,
        UPLOAD_SCANNER_CALLBACK_SECRET: undefined,
      }),
    ).toThrow(/scanner/i);
  });

  it('does not allow production to opt out of document scanning', () => {
    expect(
      validateProductionConfig({
        ...production,
        UPLOAD_MALWARE_SCANNER_REQUIRED: 'false',
      }),
    ).toMatchObject({ scannerRequired: true });
  });

  it('requires cleanup and scanner callbacks to use different secrets', () => {
    expect(() =>
      validateProductionConfig({
        ...production,
        UPLOAD_SCANNER_CALLBACK_SECRET: production.UPLOAD_CLEANUP_SECRET,
      }),
    ).toThrow(/different/i);
  });

  it('requires HTTPS, database, storage, SMTP, cleanup, and explicit proxy policy', () => {
    for (const name of [
      'APP_URL',
      'DATABASE_URL',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'S3_BUCKET',
      'S3_ENDPOINT',
      'S3_FORCE_PATH_STYLE',
      'S3_REGION',
      'SMTP_HOST',
      'SMTP_PASSWORD',
      'MAIL_FROM',
      'UPLOAD_CLEANUP_SECRET',
      'TRUST_PROXY',
    ] as const) {
      expect(() =>
        validateProductionConfig({ ...production, [name]: undefined }),
      ).toThrow(name);
    }
    expect(() =>
      validateProductionConfig({
        ...production,
        APP_URL: 'http://example.test',
      }),
    ).toThrow(/HTTPS/);
    expect(() =>
      validateProductionConfig({
        ...production,
        S3_FORCE_PATH_STYLE: 'sometimes',
      }),
    ).toThrow(/S3_FORCE_PATH_STYLE/);
  });

  it('rejects a production PostgreSQL connection without explicit TLS', () => {
    expect(() =>
      validateProductionConfig({
        ...production,
        DATABASE_URL: 'postgresql://user:secret@db.example/campuslink',
      }),
    ).toThrow(/TLS/);
  });
});
