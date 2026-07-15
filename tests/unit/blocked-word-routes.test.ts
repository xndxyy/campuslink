import { describe, expect, it, vi } from 'vitest';

import { handleBlockedWordPost } from '@/app/api/admin/blocked-words/route';
import {
  getApplicationUrl,
  isSameOriginAuthRequest,
} from '@/lib/auth/request-security';

const admin = {
  campusId: 'campus_1',
  email: 'admin@example.test',
  emailVerifiedAt: new Date(),
  id: 'admin_1',
  name: 'Admin',
  role: 'ADMIN' as const,
  status: 'ACTIVE' as const,
};

function request(body: unknown, origin = getApplicationUrl().origin) {
  return new Request('http://localhost:3000/api/admin/blocked-words', {
    body: JSON.stringify(body),
    headers: new Headers([
      ['content-type', 'application/json'],
      ['origin', origin],
    ]),
    method: 'POST',
  });
}

describe('blocked word admin route', () => {
  it('dispatches strict admin creation requests', async () => {
    const create = vi.fn(async () => ({ id: 'word_1' }));
    const input = request({
      action: 'CREATE',
      category: '诈骗引流',
      original: '违规交易',
      reason: '校园治理规则更新，需要拦截此类内容。',
    });
    expect(input.headers.get('origin')).toBe(getApplicationUrl().origin);
    expect(isSameOriginAuthRequest(input)).toBe(true);
    const response = await handleBlockedWordPost(input, {
      create,
      resolveUser: async () => admin,
    });
    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'ADMIN' }),
      expect.objectContaining({ original: '违规交易' }),
    );
  });

  it('rejects cross-origin and malformed requests before domain mutation', async () => {
    const create = vi.fn();
    const response = await handleBlockedWordPost(
      request(
        {
          action: 'CREATE',
          category: '诈骗引流',
          original: '违规交易',
          reason: 'short',
          extra: true,
        },
        'https://attacker.example',
      ),
      { create, resolveUser: async () => admin },
    );
    expect(response.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });
});
