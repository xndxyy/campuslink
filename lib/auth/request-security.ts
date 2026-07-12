import { isIP } from 'node:net';

type RuntimeEnvironment = 'development' | 'production' | 'test';

function runtimeEnvironment(
  environment = process.env.NODE_ENV as RuntimeEnvironment | undefined,
): RuntimeEnvironment {
  return environment === 'production' || environment === 'test'
    ? environment
    : 'development';
}

export function getApplicationUrl(
  appUrl?: string,
  environment = runtimeEnvironment(),
): URL {
  const configuredUrl =
    appUrl ??
    process.env.APP_URL ??
    (environment === 'production'
      ? undefined
      : (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'));

  if (!configuredUrl) {
    throw new Error('APP_URL is required in production.');
  }

  let parsed: URL;
  try {
    parsed = new URL(configuredUrl);
  } catch {
    throw new Error('APP_URL must be an absolute HTTP(S) URL.');
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    (environment === 'production' && parsed.protocol !== 'https:')
  ) {
    throw new Error('APP_URL must be an HTTPS origin in production.');
  }

  return parsed;
}

export function isSameOriginAuthRequest(
  request: Request,
  appUrl?: string,
): boolean {
  const origin = request.headers.get('origin');
  if (!origin) {
    return false;
  }

  return origin === getApplicationUrl(appUrl).origin;
}

export function isTrustedProxyConfigured(): boolean {
  return process.env.TRUST_PROXY === 'true';
}

export function getClientRateLimitKey(
  request: Request,
  trustProxy = isTrustedProxyConfigured(),
): string {
  if (!trustProxy) {
    return 'ip:direct-request';
  }

  const forwardedAddress = request.headers
    .get('x-forwarded-for')
    ?.split(',', 1)[0]
    ?.trim();

  return forwardedAddress && isIP(forwardedAddress)
    ? `ip:${forwardedAddress}`
    : 'ip:invalid-proxy-address';
}
