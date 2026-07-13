import { describe, expect, it, vi } from 'vitest';
import { handleAssetRead } from '@/app/api/assets/[id]/read/route';
import {
  ContentAuthenticationRequiredError,
  ContentForbiddenError,
} from '@/lib/domain/content-service';

describe('asset read route', () => {
  it('maps a document login requirement to 401 without signing', async () => {
    const sign = vi.fn();
    const response = await handleAssetRead('asset_doc', {
      authorize: vi.fn(async () => {
        throw new ContentAuthenticationRequiredError();
      }),
      resolveUser: async () => null,
      sign,
    });
    expect(response.status).toBe(401);
    expect(sign).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      message: 'Sign in is required to download this asset.',
    });
  });

  it('maps an authenticated authorization denial to 403', async () => {
    const response = await handleAssetRead('asset_private', {
      authorize: vi.fn(async () => {
        throw new ContentForbiddenError();
      }),
      resolveUser: async () => ({
        campusId: 'campus_1',
        email: 'other@example.test',
        emailVerifiedAt: new Date(),
        id: 'other_1',
        name: null,
        role: 'STUDENT',
        status: 'ACTIVE',
      }),
      sign: vi.fn(),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      message: 'Asset access is forbidden.',
    });
  });

  it('redirects an authorized image to a short-lived signed URL', async () => {
    const sign = vi.fn(async () => 'https://storage.example/signed-image');
    const response = await handleAssetRead('asset_image', {
      authorize: vi.fn(async () => ({
        contentType: 'image/png',
        kind: 'MARKETPLACE_IMAGE',
        storageKey: 'opaque/key',
      })),
      resolveUser: async () => null,
      sign,
    });
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://storage.example/signed-image',
    );
    expect(sign).toHaveBeenCalledWith('opaque/key', 'image/png', 'inline');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('signs an authorized announcement image inline with nosniff', async () => {
    const sign = vi.fn(async () => 'https://storage.example/announcement');
    const response = await handleAssetRead('announcement_cover', {
      authorize: vi.fn(async () => ({
        contentType: 'image/webp',
        kind: 'ANNOUNCEMENT_IMAGE',
        storageKey: 'announcements/opaque.webp',
      })),
      resolveUser: async () => null,
      sign,
    });

    expect(response.status).toBe(307);
    expect(sign).toHaveBeenCalledWith(
      'announcements/opaque.webp',
      'image/webp',
      'inline',
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('forces resource documents to download as attachments', async () => {
    const sign = vi.fn(async () => 'https://storage.example/signed-document');
    const response = await handleAssetRead('asset_document', {
      authorize: vi.fn(async () => ({
        contentType: 'application/pdf',
        kind: 'RESOURCE_DOCUMENT',
        storageKey: 'opaque/document-key',
      })),
      resolveUser: async () => ({
        campusId: 'campus_1',
        email: 'student@example.test',
        emailVerifiedAt: new Date(),
        id: 'student_1',
        name: null,
        role: 'STUDENT',
        status: 'ACTIVE',
      }),
      sign,
    });
    expect(sign).toHaveBeenCalledWith(
      'opaque/document-key',
      'application/pdf',
      'attachment',
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
