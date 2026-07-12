import { describe, expect, it } from 'vitest';

import {
  getClientRateLimitKey,
  isSameOriginAuthRequest,
} from '@/lib/auth/request-security';

describe('auth request security', () => {
  it('accepts only the configured application origin', () => {
    const request = new Request('https://app.example/api/auth/sign-in', {
      headers: { origin: 'https://app.example' },
      method: 'POST',
    });

    expect(isSameOriginAuthRequest(request, 'https://app.example')).toBe(true);
    expect(isSameOriginAuthRequest(request, 'https://other.example')).toBe(
      false,
    );
  });

  it('ignores spoofable forwarded addresses unless the proxy is explicitly trusted', () => {
    const request = new Request('http://localhost/api/auth/sign-in', {
      headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' },
      method: 'POST',
    });

    expect(getClientRateLimitKey(request, false)).toBe('ip:direct-request');
    expect(getClientRateLimitKey(request, true)).toBe('ip:198.51.100.7');
  });
});
