import 'server-only';

import { loadAnonymousIdentityKeyring } from './anonymous-identity';
import { loadAiEncryptionKey } from './encrypted-secret';
import { loadOutboundAiPolicy } from './outbound-url';

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required in production.`);
  return value;
}

function booleanPolicy(environment: NodeJS.ProcessEnv, name: string): boolean {
  const value = required(environment, name);
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${name} must be true or false.`);
  }
  return value === 'true';
}

export function validateProductionConfig(environment = process.env) {
  if (environment.NODE_ENV !== 'production') {
    return { scannerRequired: false, trustedProxy: false };
  }
  required(environment, 'AI_CONFIG_ENCRYPTION_KEY_V1');
  required(environment, 'AI_ALLOWED_HOSTS');
  loadAiEncryptionKey(environment);
  loadOutboundAiPolicy(environment);
  loadAnonymousIdentityKeyring(environment);
  const appUrl = new URL(required(environment, 'APP_URL'));
  if (appUrl.protocol !== 'https:' || appUrl.username || appUrl.password) {
    throw new Error('APP_URL must be an HTTPS origin in production.');
  }
  const databaseUrl = new URL(required(environment, 'DATABASE_URL'));
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL.');
  }
  const sslMode = databaseUrl.searchParams.get('sslmode');
  const tlsEnabled =
    ['require', 'verify-ca', 'verify-full'].includes(sslMode ?? '') ||
    databaseUrl.searchParams.get('ssl') === 'true';
  if (!tlsEnabled) {
    throw new Error('DATABASE_URL must explicitly require TLS in production.');
  }
  required(environment, 'S3_ACCESS_KEY_ID');
  required(environment, 'S3_SECRET_ACCESS_KEY');
  required(environment, 'S3_BUCKET');
  required(environment, 'S3_REGION');
  const endpoint = new URL(required(environment, 'S3_ENDPOINT'));
  if (endpoint.protocol !== 'https:') {
    throw new Error('S3_ENDPOINT must use HTTPS in production.');
  }
  booleanPolicy(environment, 'S3_FORCE_PATH_STYLE');
  required(environment, 'SMTP_HOST');
  required(environment, 'SMTP_USER');
  required(environment, 'SMTP_PASSWORD');
  required(environment, 'MAIL_FROM');
  const cleanupSecret = required(environment, 'UPLOAD_CLEANUP_SECRET');
  if (cleanupSecret.length < 32) {
    throw new Error('UPLOAD_CLEANUP_SECRET must be at least 32 characters.');
  }
  const trustedProxy = booleanPolicy(environment, 'TRUST_PROXY');
  const scannerSecret = required(environment, 'UPLOAD_SCANNER_CALLBACK_SECRET');
  if (scannerSecret.length < 32) {
    throw new Error(
      'UPLOAD_SCANNER_CALLBACK_SECRET must be at least 32 characters.',
    );
  }
  if (scannerSecret === cleanupSecret) {
    throw new Error(
      'UPLOAD_SCANNER_CALLBACK_SECRET and UPLOAD_CLEANUP_SECRET must be different.',
    );
  }
  return { scannerRequired: true, trustedProxy };
}
