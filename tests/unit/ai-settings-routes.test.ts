import { describe, expect, it, vi } from 'vitest';

import { handleAiSettingsPost } from '@/app/api/admin/ai-settings/route';
import { handleAiSettingsTestPost } from '@/app/api/admin/ai-settings/test/route';
import { getApplicationUrl } from '@/lib/auth/request-security';

const admin = {
  campusId: 'campus_1',
  email: 'admin@example.test',
  emailVerifiedAt: new Date(),
  id: 'admin_1',
  name: 'Admin',
  role: 'ADMIN' as const,
  status: 'ACTIVE' as const,
};
function request(body: unknown) {
  return new Request(`${getApplicationUrl().origin}/api/admin/ai-settings`, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      origin: getApplicationUrl().origin,
    },
    method: 'POST',
  });
}

describe('AI settings admin routes', () => {
  it('dispatches strict settings without returning the API key', async () => {
    const save = vi.fn(async () => ({ apiKeyLastFour: '1234' }));
    const response = await handleAiSettingsPost(
      request({
        apiKey: 'provider-secret-1234',
        baseUrl: 'https://api.example.test/v1',
        blockThreshold: 80,
        enabled: true,
        model: 'model',
        reason: '配置校园审核模型。',
        reviewThreshold: 40,
        timeoutMs: 8000,
      }),
      { resolveUser: async () => admin, save },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ apiKeyLastFour: '1234' });
    expect(save).toHaveBeenCalledOnce();
  });

  it('runs a fixed-payload connection test with no request body fields', async () => {
    const testConnection = vi.fn(async () => ({ ok: true }));
    const response = await handleAiSettingsTestPost(request({}), {
      resolveUser: async () => admin,
      testConnection,
    });
    expect(response.status).toBe(200);
    expect(testConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin_1' }),
    );
  });
});
