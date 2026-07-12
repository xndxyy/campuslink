export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

type RuntimeEnvironment = 'development' | 'production' | 'test';

export function getSessionCookieName(
  environment = process.env.NODE_ENV as RuntimeEnvironment | undefined,
): string {
  return environment === 'production'
    ? '__Host-campuslink-session'
    : 'campuslink-dev-session';
}

export function getSessionCookieOptions(
  environment = process.env.NODE_ENV as RuntimeEnvironment | undefined,
) {
  return {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'lax' as const,
    secure: environment === 'production',
  };
}
