import { describe, expect, it } from 'vitest';

import {
  getSessionCookieOptions,
  getSessionCookieName,
} from '@/lib/auth/session';

describe('opaque session cookie policy', () => {
  it('uses a host-only HttpOnly Lax cookie only in production', () => {
    const options = getSessionCookieOptions('production');

    expect(getSessionCookieName('production')).toBe(
      '__Host-campuslink-session',
    );
    expect(getSessionCookieName('development')).toBe('campuslink-dev-session');
    expect(options).toMatchObject({
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
    });
    expect(options).not.toHaveProperty('domain');
  });

  it('marks the session cookie secure in production', () => {
    expect(getSessionCookieOptions('production').secure).toBe(true);
    expect(getSessionCookieOptions('development').secure).toBe(false);
  });
});
