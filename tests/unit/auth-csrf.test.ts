import { describe, expect, it } from 'vitest';

import { POST as signIn } from '@/app/api/auth/sign-in/route';
import { POST as signOut } from '@/app/api/auth/sign-out/route';
import { POST as signUp } from '@/app/api/auth/sign-up/route';
import { POST as verify } from '@/app/api/auth/verify/route';
import { POST as resend } from '@/app/api/auth/resend-verification/route';

const authRoutes = [signUp, signIn, signOut, verify, resend];

describe('auth mutation CSRF protection', () => {
  it.each(authRoutes)(
    'rejects a cross-origin POST before authentication state changes',
    async (post) => {
      const response = await post(
        new Request('http://localhost/api/auth/test', {
          body: JSON.stringify({}),
          headers: {
            'content-type': 'application/json',
            origin: 'https://attacker.example',
          },
          method: 'POST',
        }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        message: 'Invalid request origin.',
      });
    },
  );
});
