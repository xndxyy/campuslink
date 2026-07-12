import { describe, expect, it, vi } from 'vitest';

import {
  handleFavouriteDelete,
  handleFavouritePost,
  handleMarketplaceContactPost,
  handleReportPost,
} from '@/lib/domain/engagement-routes';
import {
  ReportDuplicateError,
  ReportOwnContentError,
} from '@/lib/domain/reports';

const user = {
  campusId: 'campus_1',
  email: 'student@campuslink.edu',
  emailVerifiedAt: new Date(),
  id: 'user_1',
  name: 'Student',
  role: 'STUDENT' as const,
  status: 'ACTIVE' as const,
};

function request(
  path: string,
  body?: unknown,
  origin = 'http://localhost:3000',
) {
  return new Request(`http://localhost${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin },
    method: 'POST',
  });
}

describe('engagement routes', () => {
  it('rejects cross-origin requests before auth and always returns no-store', async () => {
    const resolveUser = vi.fn(async () => user);
    const response = await handleFavouritePost(
      request('/api/favourites', {}, 'https://attacker.example'),
      { mutate: vi.fn(), resolveUser },
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(resolveUser).not.toHaveBeenCalled();
  });

  it('requires a verified user and rejects client-owned userId', async () => {
    const denied = await handleFavouritePost(
      request('/api/favourites', {
        targetId: 'resource_1',
        targetType: 'RESOURCE',
      }),
      {
        mutate: vi.fn(),
        resolveUser: async () => ({ ...user, emailVerifiedAt: null }),
      },
    );
    expect(denied.status).toBe(403);

    const invalid = await handleFavouritePost(
      request('/api/favourites', {
        targetId: 'resource_1',
        targetType: 'RESOURCE',
        userId: 'attacker',
      }),
      { mutate: vi.fn(), resolveUser: async () => user },
    );
    expect(invalid.status).toBe(400);
  });

  it('supports idempotent favourite add and delete actions', async () => {
    const mutate = vi.fn(async () => ({ favourited: true }));
    const add = await handleFavouritePost(
      request('/api/favourites', {
        targetId: 'resource_1',
        targetType: 'RESOURCE',
      }),
      { mutate, resolveUser: async () => user },
    );
    expect(add.status).toBe(200);
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: user.id }),
      { targetId: 'resource_1', targetType: 'RESOURCE' },
      'add',
    );

    const remove = await handleFavouriteDelete(
      request('/api/favourites', {
        targetId: 'resource_1',
        targetType: 'RESOURCE',
      }),
      { mutate, resolveUser: async () => user },
    );
    expect(remove.status).toBe(200);
    expect(mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: user.id }),
      { targetId: 'resource_1', targetType: 'RESOURCE' },
      'remove',
    );
  });

  it('validates strict report reasons and maps self/duplicate safely', async () => {
    const invalid = await handleReportPost(
      request('/api/reports', {
        reason: 'FREE_TEXT_REASON',
        targetId: 'job_1',
        targetType: 'JOB_POST',
      }),
      { create: vi.fn(), resolveUser: async () => user },
    );
    expect(invalid.status).toBe(400);

    const own = await handleReportPost(
      request('/api/reports', {
        reason: 'SPAM',
        targetId: 'job_1',
        targetType: 'JOB_POST',
      }),
      {
        create: vi.fn(async () => {
          throw new ReportOwnContentError();
        }),
        resolveUser: async () => user,
      },
    );
    expect(own.status).toBe(403);
    await expect(own.json()).resolves.toEqual({
      message: 'Cannot report own content',
    });

    const duplicate = await handleReportPost(
      request('/api/reports', {
        reason: 'SPAM',
        targetId: 'job_1',
        targetType: 'JOB_POST',
      }),
      {
        create: vi.fn(async () => {
          throw new ReportDuplicateError();
        }),
        resolveUser: async () => user,
      },
    );
    expect(duplicate.status).toBe(409);
  });

  it('rate limits contact before service execution and never caches responses', async () => {
    const contact = vi.fn(async () => ({ contact: 'seller@campus.example' }));
    const limited = await handleMarketplaceContactPost(
      request('/api/marketplace/market_1/contact'),
      'market_1',
      {
        contact,
        limiter: {
          consume: vi.fn(async () => ({
            allowed: false,
            retryAfterSeconds: 30,
          })),
        },
        resolveUser: async () => user,
      },
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('30');
    expect(limited.headers.get('cache-control')).toContain('no-store');
    expect(contact).not.toHaveBeenCalled();

    const success = await handleMarketplaceContactPost(
      request('/api/marketplace/market_1/contact'),
      'market_1',
      {
        contact,
        limiter: {
          consume: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
        },
        resolveUser: async () => user,
      },
    );
    expect(success.status).toBe(200);
    await expect(success.json()).resolves.toEqual({
      contact: 'seller@campus.example',
    });
    expect(success.headers.get('cache-control')).toContain('no-store');
  });

  it('maps unexpected errors without leaking database or contact details', async () => {
    const response = await handleMarketplaceContactPost(
      request('/api/marketplace/market_1/contact'),
      'market_1',
      {
        contact: vi.fn(async () => {
          throw new Error('postgres password secret seller@campus.example');
        }),
        limiter: {
          consume: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
        },
        resolveUser: async () => user,
      },
    );
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain('secret');
    expect(body).not.toContain('seller@campus.example');
  });
});
