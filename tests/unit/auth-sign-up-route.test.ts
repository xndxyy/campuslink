import { describe, expect, it } from 'vitest';

import { POST } from '@/app/api/auth/sign-up/route';

describe('sign-up route', () => {
  it('returns a clear validation error for mismatched password confirmation', async () => {
    const response = await POST(
      new Request('http://localhost/api/auth/sign-up', {
        body: JSON.stringify({
          confirmPassword: 'DifferentCampus!42',
          email: 'student@campuslink.edu',
          name: 'Student One',
          password: 'SafeCampus!42',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: 'Passwords do not match.',
    });
  });
});
