import { describe, expect, it, vi } from 'vitest';

import { handleUploadCleanup } from '@/app/api/internal/uploads/cleanup/route';

const secret = 'a'.repeat(48);

function request(authorization?: string) {
  return new Request('http://localhost/api/internal/uploads/cleanup', {
    headers: authorization ? { authorization } : undefined,
    method: 'POST',
  });
}

describe('scheduled upload cleanup route', () => {
  it.each([undefined, 'Bearer wrong-secret'])(
    'rejects a missing or wrong bearer secret',
    async (authorization) => {
      const cleanup = vi.fn();
      const response = await handleUploadCleanup(request(authorization), {
        cleanup,
        secret,
      });

      expect(response.status).toBe(401);
      expect(cleanup).not.toHaveBeenCalled();
    },
  );

  it('fails closed when the server secret is not configured', async () => {
    const response = await handleUploadCleanup(
      request(`Bearer ${secret}`),
      { cleanup: vi.fn(), secret: undefined },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      message: 'Upload cleanup is unavailable.',
    });
  });

  it('runs cleanup with the exact bearer secret and returns counts only', async () => {
    const cleanup = vi.fn(async () => ({
      deletedPending: 2,
      failed: 1,
      retainedRejected: 3,
    }));
    const response = await handleUploadCleanup(
      request(`Bearer ${secret}`),
      { cleanup, secret },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deletedPending: 2,
      failed: 1,
      retainedRejected: 3,
    });
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
