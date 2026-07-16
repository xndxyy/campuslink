import { describe, expect, it, vi } from 'vitest';

import { handleCompleteUpload } from '@/app/api/uploads/complete/route';
import { handleUploadIntent } from '@/app/api/uploads/intent/route';
import {
  UploadConflictError,
  UploadForbiddenError,
} from '@/lib/storage/policy';

const user = {
  campusId: 'campus_1',
  email: 'student@campuslink.edu',
  emailVerifiedAt: new Date(),
  id: 'user_upload_owner',
  name: 'Upload Owner',
  role: 'STUDENT' as const,
  status: 'ACTIVE' as const,
};

function jsonRequest(
  path: string,
  body: unknown,
  origin = new URL(process.env.APP_URL ?? 'http://localhost:3000').origin,
) {
  return new Request(`http://localhost${path}`, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin },
    method: 'POST',
  });
}

describe('upload routes', () => {
  it.each(['STUDENT', 'MODERATOR'] as const)(
    'forbids verified %s users from creating announcement image intents',
    async (role) => {
      const createIntent = vi.fn(async () => ({ assetId: 'asset_forbidden' }));
      const response = await handleUploadIntent(
        jsonRequest('/api/uploads/intent', {
          contentType: 'image/png',
          fileName: 'announcement.png',
          kind: 'ANNOUNCEMENT_IMAGE',
          sizeBytes: 1_024,
        }),
        {
          createIntent,
          resolveUser: async () => ({ ...user, role }),
        },
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        message: '权限不足。',
      });
      expect(createIntent).not.toHaveBeenCalled();
    },
  );

  it('allows a verified administrator to create an announcement image intent', async () => {
    const createIntent = vi.fn(async () => ({ assetId: 'asset_cover' }));
    const response = await handleUploadIntent(
      jsonRequest('/api/uploads/intent', {
        contentType: 'image/png',
        fileName: 'announcement.png',
        kind: 'ANNOUNCEMENT_IMAGE',
        sizeBytes: 1_024,
      }),
      {
        createIntent,
        resolveUser: async () => ({ ...user, role: 'ADMIN' }),
      },
    );

    expect(response.status).toBe(201);
    expect(createIntent).toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({ kind: 'ANNOUNCEMENT_IMAGE' }),
    );
  });

  it.each([
    ['STUDENT', 'RESOURCE_DOCUMENT', 'notes.pdf', 'application/pdf'],
    ['MODERATOR', 'RESOURCE_DOCUMENT', 'notes.pdf', 'application/pdf'],
    ['STUDENT', 'RESOURCE_IMAGE', 'diagram.png', 'image/png'],
    ['MODERATOR', 'RESOURCE_IMAGE', 'diagram.png', 'image/png'],
    ['STUDENT', 'MARKETPLACE_IMAGE', 'item.webp', 'image/webp'],
    ['MODERATOR', 'MARKETPLACE_IMAGE', 'item.webp', 'image/webp'],
  ] as const)(
    'keeps %s access to %s upload intents',
    async (role, kind, fileName, contentType) => {
      const createIntent = vi.fn(async () => ({ assetId: 'asset_existing' }));
      const response = await handleUploadIntent(
        jsonRequest('/api/uploads/intent', {
          contentType,
          fileName,
          kind,
          sizeBytes: 1_024,
        }),
        {
          createIntent,
          resolveUser: async () => ({ ...user, role }),
        },
      );

      expect(response.status).toBe(201);
      expect(createIntent).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({ kind }),
      );
    },
  );

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
      message: '上传信息无效。',
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
      message: '暂时无法完成上传，请稍后重试。',
    });
  });
});
