import { describe, expect, it, vi } from 'vitest';

import { handleAssetScanCallback } from '@/app/api/internal/uploads/scan-result/route';

const secret = 's'.repeat(32);

function request(
  token = secret,
  body: unknown = {
    assetId: 'asset_1',
    sha256: 'a'.repeat(64),
    verdict: 'CLEAN',
  },
) {
  return new Request(
    'https://campus.example/api/internal/uploads/scan-result',
    {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  );
}

describe('scanner callback route', () => {
  it('requires the dedicated callback secret before parsing or writing', async () => {
    const record = vi.fn();
    const response = await handleAssetScanCallback(request('wrong'), {
      record,
      secret,
    });
    expect(response.status).toBe(401);
    expect(record).not.toHaveBeenCalled();
  });

  it('validates a bounded callback payload and records the verdict', async () => {
    const record = vi.fn(async () => ({
      assetId: 'asset_1',
      scanStatus: 'CLEAN' as const,
    }));
    const response = await handleAssetScanCallback(request(), {
      record,
      secret,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      assetId: 'asset_1',
      scanStatus: 'CLEAN',
    });
    expect(record).toHaveBeenCalledWith({
      assetId: 'asset_1',
      sha256: 'a'.repeat(64),
      verdict: 'CLEAN',
    });
  });

  it('rejects invalid verdicts without calling the scanner service', async () => {
    const record = vi.fn();
    const response = await handleAssetScanCallback(
      request(secret, {
        assetId: 'asset_1',
        sha256: 'a'.repeat(64),
        verdict: 'MAYBE',
      }),
      { record, secret },
    );
    expect(response.status).toBe(400);
    expect(record).not.toHaveBeenCalled();
  });

  it('returns 413 for a callback larger than the JSON limit', async () => {
    const record = vi.fn();
    const response = await handleAssetScanCallback(
      request(secret, { padding: 'x'.repeat(65 * 1024) }),
      { record, secret },
    );
    expect(response.status).toBe(413);
    expect(record).not.toHaveBeenCalled();
  });
});
