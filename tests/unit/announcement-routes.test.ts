import { describe, expect, it, vi } from 'vitest';

import {
  handleAnnouncementDelete,
  handleAnnouncementPost,
} from '@/app/api/admin/announcements/route';
import { handleStorageDeletions } from '@/app/api/internal/storage-deletions/route';
import { AnnouncementConflictError } from '@/lib/domain/announcements';

const admin = {
  campusId: 'campus_1',
  email: 'admin@example.com',
  emailVerifiedAt: new Date(),
  id: 'admin_1',
  name: 'Admin',
  role: 'ADMIN' as const,
  status: 'ACTIVE' as const,
};
const origin = new URL(process.env.APP_URL ?? 'http://localhost:3000').origin;

function jsonRequest(method: string, body: unknown, requestOrigin = origin) {
  return new Request('http://localhost/api/admin/announcements', {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: requestOrigin },
    method,
  });
}

describe('announcement administrator route', () => {
  it('allows ordinary comparison prose through to the create dependency', async () => {
    const create = vi.fn(async () => ({ id: 'announcement_1' }));
    const response = await handleAnnouncementPost(
      jsonRequest('POST', {
        body: 'x < y and z > 0',
        coverAssetId: null,
        isPinned: false,
        title: 'x < y and z > 0',
      }),
      { create, resolveUser: async () => admin },
    );
    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledWith(
      { campusId: admin.campusId, id: admin.id, role: 'ADMIN' },
      {
        body: 'x < y and z > 0',
        coverAssetId: null,
        isPinned: false,
        title: 'x < y and z > 0',
      },
    );
  });

  it.each([
    '<img src=x onerror=alert(1)>',
    '<!--comment-->',
    '<!DOCTYPE html>',
    '<script',
    '< script',
    '<b>',
    'javascript:alert(1)',
  ])('rejects unsafe plain text before invoking create: %s', async (value) => {
    const create = vi.fn();
    const response = await handleAnnouncementPost(
      jsonRequest('POST', {
        body: value,
        coverAssetId: null,
        isPinned: false,
        title: 'Safe title',
      }),
      { create, resolveUser: async () => admin },
    );
    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin POST before resolving the user', async () => {
    const create = vi.fn();
    const resolveUser = vi.fn(async () => admin);
    const response = await handleAnnouncementPost(
      jsonRequest('POST', {}, 'https://attacker.example'),
      { create, resolveUser },
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(resolveUser).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['STUDENT', 'MODERATOR'] as const)(
    'rejects %s before invoking the create dependency',
    async (role) => {
      const create = vi.fn();
      const response = await handleAnnouncementPost(
        jsonRequest('POST', {
          body: '正文',
          coverAssetId: null,
          isPinned: false,
          title: '校园公告',
        }),
        { create, resolveUser: async () => ({ ...admin, role }) },
      );
      expect(response.status).toBe(403);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed, oversized, and unknown-field input safely', async () => {
    const dependencies = { create: vi.fn(), resolveUser: async () => admin };
    const unknown = await handleAnnouncementPost(
      jsonRequest('POST', {
        body: '正文',
        coverAssetId: null,
        isPinned: false,
        ownerId: 'attacker',
        title: '校园公告',
      }),
      dependencies,
    );
    expect(unknown.status).toBe(400);

    const malformed = new Request('http://localhost/api/admin/announcements', {
      body: '{',
      headers: { 'content-type': 'application/json', origin },
      method: 'POST',
    });
    expect((await handleAnnouncementPost(malformed, dependencies)).status).toBe(
      400,
    );

    const oversized = new Request('http://localhost/api/admin/announcements', {
      body: JSON.stringify({ body: 'x'.repeat(70_000) }),
      headers: { 'content-type': 'application/json', origin },
      method: 'POST',
    });
    expect((await handleAnnouncementPost(oversized, dependencies)).status).toBe(
      413,
    );
    expect(dependencies.create).not.toHaveBeenCalled();
  });

  it('creates valid input and returns a no-store response', async () => {
    const create = vi.fn(async () => ({ id: 'announcement_1' }));
    const response = await handleAnnouncementPost(
      jsonRequest('POST', {
        body: '  正文  ',
        coverAssetId: null,
        isPinned: false,
        title: '  校园公告  ',
      }),
      { create, resolveUser: async () => admin },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(create).toHaveBeenCalledWith(
      { campusId: admin.campusId, id: admin.id, role: 'ADMIN' },
      { body: '正文', coverAssetId: null, isPinned: false, title: '校园公告' },
    );
  });

  it('uses a strict DELETE body and safe conflict mapping', async () => {
    const remove = vi.fn(async () => {
      throw new AnnouncementConflictError('P2002 storage secret');
    });
    const response = await handleAnnouncementDelete(
      jsonRequest('DELETE', { id: 'announcement_1' }),
      { remove, resolveUser: async () => admin },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      message: 'Announcement state conflict.',
    });
  });
});

describe('internal storage deletion route', () => {
  const secret = 's'.repeat(48);
  function request(authorization?: string) {
    return new Request('http://localhost/api/internal/storage-deletions', {
      headers: authorization ? { authorization } : undefined,
      method: 'POST',
    });
  }

  it('fails closed for missing or short configuration', async () => {
    const process = vi.fn();
    const response = await handleStorageDeletions(request(`Bearer ${secret}`), {
      process,
      secret: 'short',
    });
    expect(response.status).toBe(503);
    expect(process).not.toHaveBeenCalled();
  });

  it.each([undefined, 'Bearer wrong'])(
    'rejects %s authorization',
    async (header) => {
      const process = vi.fn();
      const response = await handleStorageDeletions(request(header), {
        process,
        secret,
      });
      expect(response.status).toBe(401);
      expect(process).not.toHaveBeenCalled();
    },
  );

  it('returns safe counts and hides processing failures', async () => {
    const ok = await handleStorageDeletions(request(`Bearer ${secret}`), {
      process: vi.fn(async () => ({
        deferred: 4,
        deleted: 2,
        missing: 1,
        retried: 3,
      })),
      secret,
    });
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({
      deferred: 4,
      deleted: 2,
      missing: 1,
      retried: 3,
    });

    const failed = await handleStorageDeletions(request(`Bearer ${secret}`), {
      process: vi.fn(async () => {
        throw new Error('storage key and secret');
      }),
      secret,
    });
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toEqual({
      message: 'Storage deletion processing failed.',
    });
  });
});
