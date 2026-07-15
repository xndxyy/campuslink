import { describe, expect, it, vi } from 'vitest';

import {
  OutboundUrlRejectedError,
  fetchWithValidatedAiRedirects,
  validateOutboundAiUrl,
} from '@/lib/security/outbound-url';

describe('AI provider outbound URL policy', () => {
  const policy = { allowedHosts: new Set(['api.example.test']) };

  it.each([
    'http://api.example.test/v1',
    'https://user:pass@api.example.test/v1',
    'https://127.0.0.1/v1',
    'https://other.example.test/v1',
  ])('rejects unsafe provider URL %s', async (url) => {
    await expect(
      validateOutboundAiUrl(url, policy, vi.fn()),
    ).rejects.toBeInstanceOf(OutboundUrlRejectedError);
  });

  it('rejects when any DNS result is private', async () => {
    const lookup = vi.fn(async () => [
      { address: '203.0.113.10', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    await expect(
      validateOutboundAiUrl('https://api.example.test/v1', policy, lookup),
    ).rejects.toBeInstanceOf(OutboundUrlRejectedError);
  });

  it('accepts an exact allowlisted host with only public addresses', async () => {
    const lookup = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]);
    await expect(
      validateOutboundAiUrl('https://api.example.test/v1', policy, lookup),
    ).resolves.toEqual(new URL('https://api.example.test/v1'));
  });

  it('pins the actual request client to the validated DNS addresses', async () => {
    const addresses = [{ address: '8.8.8.8', family: 4 }];
    const lookup = vi.fn(async () => addresses);
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const fetcherFactory = vi.fn(() => fetcher);
    await fetchWithValidatedAiRedirects(
      'https://api.example.test/v1',
      policy,
      { method: 'POST' },
      { fetcherFactory, lookup },
    );
    expect(fetcherFactory).toHaveBeenCalledWith(addresses);
  });

  it('revalidates redirects and rejects a redirect to loopback', async () => {
    const lookup = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]);
    const fetcher = vi.fn(
      async () =>
        new Response(null, {
          headers: { location: 'https://127.0.0.1/private' },
          status: 302,
        }),
    );
    await expect(
      fetchWithValidatedAiRedirects(
        'https://api.example.test/v1',
        policy,
        { method: 'POST' },
        { fetcher, lookup },
      ),
    ).rejects.toBeInstanceOf(OutboundUrlRejectedError);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
