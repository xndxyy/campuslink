import { describe, expect, it } from 'vitest';

import { POST } from '@/app/api/auth/sign-up/route';

describe('sign-up route', () => {
  it('validates the identity-only pending registration request', async () => {
    const origin = new URL(process.env.APP_URL ?? 'http://localhost:3000')
      .origin;
    const response = await POST(
      new Request('http://localhost/api/auth/sign-up', {
        body: JSON.stringify({
          email: 'student@campuslink.edu',
        }),
        headers: {
          'content-type': 'application/json',
          origin,
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: 'Invalid registration details.',
    });
  });
});
