import { describe, expect, it, vi } from 'vitest';

import { handleCompleteUpload } from '@/app/api/uploads/complete/route';
import { handleUploadIntent } from '@/app/api/uploads/intent/route';
import {
  UploadConflictError,
  UploadForbiddenError,
} from '@/lib/storage/policy';

const user = {
  email: 'student@campuslink.edu',
  emailVerifiedAt: new Date(),
  id: 'user_upload_owner',
  name: 'Upload Owner',
  role: 'STUDENT' as const,
  status: 'ACTIVE' as const,
};

function jsonRequest(path: string, body: unknown, origin = 'http://localhost:3000') {
  return new Request(`http://localhost${path}`, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin },
    method: 'POST',
  });
}

describe('upload routes', () => {
  it('checks exact origin before resolving an upload-intent session', async () => {
    const resolveUser = vi.fn(async () => user);
    const createIntent = vi.fn();

    const response = await handleUploadIntent(
      jsonRequest(
        '/api/uploads/intent',
        {
          contentType: 'application/pdf',
          fileName: 'notes.pdf',
          kind: 'RESOURCE_DOCUMENT',
          sizeBytes: 1_024,
        },
        'https://attacker.example',
      ),
      { createIntent, resolveUser },
    );

    expect(response.status).toBe(403);
    expect(resolveUser).not.toHaveBeenCalled();
    expect(createIntent).not.toHaveBeenCalled();
  });

  it('maps a missing session to 401', async () => {
    const response = await handleUploadIntent(
      jsonRequest('/api/uploads/intent', {
        contentType: 'application/pdf',
        fileName: 'notes.pdf',
        kind: 'RESOURCE_DOCUMENT',
        sizeBytes: 1_024,
      }),
      { createIntent: vi.fn(), resolveUser: async () => null },
    );

    expect(response.status).toBe(401);
  });

  it('rejects invalid JSON upload intent details with 400', async () => {
    const response = await handleUploadIntent(
      jsonRequest('/api/uploads/intent', {
        contentType: 'image/svg+xml',
        fileName: 'unsafe.svg',
        kind: 'RESOURCE_IMAGE',
        sizeBytes: 100,
      }),
      { createIntent: vi.fn(), resolveUser: async () => user },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: 'Invalid upload details.',
    });
  });

  it('maps another owner completing an upload to 403', async () => {
    const response = await handleCompleteUpload(
      jsonRequest('/api/uploads/complete', { assetId: 'asset_other' }),
      {
        complete: vi.fn(async () => {
          throw new UploadForbiddenError();
        }),
        resolveUser: async () => user,
      },
    );

    expect(response.status).toBe(403);
  });

  it('maps upload state conflicts to 409', async () => {
    const response = await handleCompleteUpload(
      jsonRequest('/api/uploads/complete', { assetId: 'asset_pending' }),
      {
        complete: vi.fn(async () => {
          throw new UploadConflictError();
        }),
        resolveUser: async () => user,
      },
    );

    expect(response.status).toBe(409);
  });

  it('does not expose storage errors in a 500 response', async () => {
    const response = await handleCompleteUpload(
      jsonRequest('/api/uploads/complete', { assetId: 'asset_pending' }),
      {
        complete: vi.fn(async () => {
          throw new Error('secret-key=https://storage.internal');
        }),
        resolveUser: async () => user,
      },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: 'Unable to complete upload.',
    });
  });
});
