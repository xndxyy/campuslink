import { randomBytes } from 'node:crypto';

type Environment = 'development' | 'production' | 'test';

function allowedStorageOrigin(endpoint?: string): string | null {
  if (!endpoint) return null;
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol === 'https:') return parsed.origin;
    if (
      parsed.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
    ) {
      return parsed.origin;
    }
  } catch {
    return null;
  }
  return null;
}

function virtualHostStorageOrigin(
  endpoint: string | undefined,
  bucket: string | undefined,
  forcePathStyle: boolean,
): string | null {
  if (!endpoint || !bucket || forcePathStyle) return null;
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) return null;
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'https:') return null;
    parsed.hostname = `${bucket}.${parsed.hostname}`;
    parsed.pathname = '/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.origin;
  } catch {
    return null;
  }
}

export function buildSecurityHeaders(
  environment: Environment,
  storageEndpoint?: string,
  storageBucket?: string,
  forcePathStyle = false,
) {
  const nonce = randomBytes(16).toString('base64url');
  const storageOrigin = allowedStorageOrigin(storageEndpoint);
  const virtualStorageOrigin = virtualHostStorageOrigin(
    storageEndpoint,
    storageBucket,
    forcePathStyle,
  );
  const scriptSource = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(environment === 'development' ? ["'unsafe-eval'"] : []),
  ].join(' ');
  const connectSource = ["'self'", storageOrigin, virtualStorageOrigin]
    .filter(Boolean)
    .join(' ');
  const imageSource = [
    "'self'",
    'data:',
    'blob:',
    'https:',
    storageOrigin,
    virtualStorageOrigin,
  ]
    .filter(Boolean)
    .join(' ');
  const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `img-src ${imageSource}`,
    `connect-src ${connectSource}`,
    "font-src 'self' data:",
    // React and the current CSS stack emit style attributes. Scripts remain nonce-only.
    "style-src 'self' 'unsafe-inline'",
    `script-src ${scriptSource}`,
    "worker-src 'self' blob:",
  ].join('; ');

  return {
    headers: {
      'Content-Security-Policy': contentSecurityPolicy,
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
    },
    nonce,
  };
}
