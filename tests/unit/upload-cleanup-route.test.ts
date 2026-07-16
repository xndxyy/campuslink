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
    vi.stubEnv('UPLOAD_CLEANUP_SECRET', '');
    try {
      const response = await handleUploadCleanup(request(`Bearer ${secret}`), {
        cleanup: vi.fn(),
        secret: undefined,
      });

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        message: '上传清理任务暂时不可用。',
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each(['x', 'x'.repeat(31), ' \t '])(
    'fails closed when the configured secret is too weak',
    async (configuredSecret) => {
      const cleanup = vi.fn();
      const response = await handleUploadCleanup(request('Bearer x'), {
        cleanup,
        secret: configuredSecret,
      });

      expect(response.status).toBe(503);
      expect(cleanup).not.toHaveBeenCalled();
    },
  );

  it('trims a valid configured secret but compares the bearer token exactly', async () => {
    const minimumSecret = 'b'.repeat(32);
    const cleanup = vi.fn(async () => ({
      deletedPending: 0,
      failed: 0,
      retainedRejected: 0,
    }));

    const rejected = await handleUploadCleanup(
      request(`Bearer  ${minimumSecret}`),
      { cleanup, secret: `  ${minimumSecret}\t` },
    );
    expect(rejected.status).toBe(401);
    expect(cleanup).not.toHaveBeenCalled();

    const accepted = await handleUploadCleanup(
      request(`Bearer ${minimumSecret}`),
      { cleanup, secret: `  ${minimumSecret}\t` },
    );
    expect(accepted.status).toBe(200);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('runs cleanup with the exact bearer secret and returns counts only', async () => {
    const cleanup = vi.fn(async () => ({
      deletedPending: 2,
      failed: 1,
      retainedRejected: 3,
    }));
    const response = await handleUploadCleanup(request(`Bearer ${secret}`), {
      cleanup,
      secret,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deletedPending: 2,
      failed: 1,
      retainedRejected: 3,
    });
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
