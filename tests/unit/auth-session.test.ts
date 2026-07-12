import { describe, expect, it } from 'vitest';

import {
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/session';

describe('opaque session cookie policy', () => {
  it('uses a host-only HttpOnly Lax cookie', () => {
    const options = getSessionCookieOptions();

    expect(SESSION_COOKIE_NAME).toBe('__Host-campuslink-session');
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
