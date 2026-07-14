import { describe, expect, it, vi } from 'vitest';

import { handleTagGet, handleTagPost } from '@/app/api/admin/tags/route';
import {
  TagConflictError,
  TagForbiddenError,
  encodeManagedTagCursor,
} from '@/lib/domain/tags';
import { TagValidationError } from '@/lib/validation/tags';

const admin = {
  campusId: 'campus_1',
  email: 'admin@example.edu',
  emailVerifiedAt: new Date(),
  id: 'admin_1',
  name: 'Admin',
  role: 'ADMIN' as const,
  status: 'ACTIVE' as const,
};
const origin = new URL(process.env.APP_URL ?? 'http://localhost:3000').origin;

function request(body: unknown, requestOrigin = origin) {
  return new Request('http://localhost/api/admin/tags', {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: requestOrigin },
    method: 'POST',
  });
}

describe('tag administrator route API', () => {
  it('exposes injectable GET and POST handlers', async () => {
    const route = await import('@/app/api/admin/tags/route').catch(() => ({}));
    expect(route).toMatchObject({
      handleTagGet: expect.any(Function),
      handleTagPost: expect.any(Function),
    });
  });

  it('strictly accepts one valid scope and returns a no-store managed list', async () => {
    const cursor = encodeManagedTagCursor({ id: 'tag_0', label: '基础' });
    const result = {
      hasNextPage: true,
      items: [{ id: 'tag_1', isActive: true, isPreset: true, label: '课程' }],
      nextCursor: encodeManagedTagCursor({ id: 'tag_1', label: '课程' }),
    };
    const list = vi.fn(async () => result);
    const response = await handleTagGet(
      new Request(
        `http://localhost/api/admin/tags?scope=RESOURCE&pageSize=2&cursor=${encodeURIComponent(cursor)}`,
      ),
      { list, resolveUser: async () => admin },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(list).toHaveBeenCalledWith(
      { campusId: admin.campusId, id: admin.id, role: 'ADMIN' },
      'RESOURCE',
      { cursor: { id: 'tag_0', label: '基础' }, pageSize: 2 },
    );
    await expect(response.json()).resolves.toEqual({
      ...result,
      scope: 'RESOURCE',
    });
  });

  it.each([
    '',
    '?scope=RESOURCE&scope=MARKETPLACE',
    '?scope=INVALID',
    '?scope=RESOURCE&unknown=1',
    '?scope=RESOURCE&pageSize=0',
    '?scope=RESOURCE&pageSize=101',
    '?scope=RESOURCE&pageSize=2&pageSize=3',
    '?scope=RESOURCE&cursor=',
    '?scope=RESOURCE&cursor=not-a-cursor',
  ])('rejects an invalid strict GET query %s', async (query) => {
    const list = vi.fn();
    const response = await handleTagGet(
      new Request(`http://localhost/api/admin/tags${query}`),
      { list, resolveUser: async () => admin },
    );
    expect(response.status).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });

  it.each(['STUDENT', 'MODERATOR'] as const)(
    'rejects %s access to managed tags',
    async (role) => {
      const list = vi.fn();
      const response = await handleTagGet(
        new Request('http://localhost/api/admin/tags?scope=RESOURCE'),
        { list, resolveUser: async () => ({ ...admin, role }) },
      );
      expect(response.status).toBe(403);
      expect(list).not.toHaveBeenCalled();
    },
  );

  it('rejects cross-origin POST before resolving the user', async () => {
    const resolveUser = vi.fn(async () => admin);
    const mutate = vi.fn();
    const response = await handleTagPost(
      request(
        {
          action: 'CREATE_PRESET',
          label: '课程',
          reason: 'Campus tag policy.',
          scope: 'RESOURCE',
        },
        'https://attacker.example',
      ),
      { create: mutate, resolveUser },
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(resolveUser).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('dispatches each strict action with only its approved fields', async () => {
    const create = vi.fn(async () => ({ id: 'created' }));
    const setActive = vi.fn(async () => ({ id: 'status' }));
    const promote = vi.fn(async () => ({ id: 'promoted' }));
    const dependencies = {
      create,
      promote,
      resolveUser: async () => admin,
      setActive,
    };

    expect(
      (
        await handleTagPost(
          request({
            action: 'CREATE_PRESET',
            label: '  ＣＯＳ   委托  ',
            reason: '  Campus tag policy.  ',
            scope: 'RESOURCE',
          }),
          dependencies,
        )
      ).status,
    ).toBe(200);
    expect(create).toHaveBeenCalledWith(
      { campusId: admin.campusId, id: admin.id, role: 'ADMIN' },
      {
        label: 'COS 委托',
        reason: 'Campus tag policy.',
        scope: 'RESOURCE',
      },
    );

    expect(
      (
        await handleTagPost(
          request({
            action: 'SET_ACTIVE',
            active: false,
            reason: 'Disable after review.',
            scope: 'MARKETPLACE',
            tagId: 'tag_1',
          }),
          dependencies,
        )
      ).status,
    ).toBe(200);
    expect(setActive).toHaveBeenCalledWith(
      { campusId: admin.campusId, id: admin.id, role: 'ADMIN' },
      {
        active: false,
        reason: 'Disable after review.',
        scope: 'MARKETPLACE',
        tagId: 'tag_1',
      },
    );

    expect(
      (
        await handleTagPost(
          request({
            action: 'PROMOTE_CUSTOM',
            reason: 'Frequently used campus label.',
            scope: 'CAMPUS_WORK',
            tagId: 'tag_2',
          }),
          dependencies,
        )
      ).status,
    ).toBe(200);
    expect(promote).toHaveBeenCalledWith(
      { campusId: admin.campusId, id: admin.id, role: 'ADMIN' },
      {
        reason: 'Frequently used campus label.',
        scope: 'CAMPUS_WORK',
        tagId: 'tag_2',
      },
    );
  });

  it.each([
    {},
    { action: 'UNKNOWN' },
    {
      action: 'CREATE_PRESET',
      campusId: 'campus_2',
      label: '课程',
      reason: 'Campus tag policy.',
      scope: 'RESOURCE',
    },
    {
      action: 'CREATE_PRESET',
      label: '<b>课程</b>',
      reason: 'Unsafe markup must be rejected.',
      scope: 'RESOURCE',
    },
    {
      action: 'SET_ACTIVE',
      active: 'false',
      reason: 'Disable after review.',
      scope: 'RESOURCE',
      tagId: 'tag_1',
    },
    {
      action: 'PROMOTE_CUSTOM',
      reason: 'no',
      scope: 'RESOURCE',
      tagId: 'tag_1',
    },
  ])('rejects invalid strict union body %o', async (body) => {
    const create = vi.fn();
    const response = await handleTagPost(request(body), {
      create,
      resolveUser: async () => admin,
    });
    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects malformed and oversized JSON safely', async () => {
    const dependencies = { create: vi.fn(), resolveUser: async () => admin };
    const malformed = new Request('http://localhost/api/admin/tags', {
      body: '{',
      headers: { 'content-type': 'application/json', origin },
      method: 'POST',
    });
    expect((await handleTagPost(malformed, dependencies)).status).toBe(400);
    const oversized = new Request('http://localhost/api/admin/tags', {
      body: JSON.stringify({ label: 'x'.repeat(70_000) }),
      headers: { 'content-type': 'application/json', origin },
      method: 'POST',
    });
    expect((await handleTagPost(oversized, dependencies)).status).toBe(413);
  });

  it.each([
    [new TagValidationError('INVALID_INPUT'), 400],
    [new TagForbiddenError(), 403],
    [new TagConflictError(), 409],
    [new Error('P2002 database secret'), 500],
  ])('maps domain error safely to %s', async (error, status) => {
    const response = await handleTagPost(
      request({
        action: 'CREATE_PRESET',
        label: '课程',
        reason: 'Campus tag policy.',
        scope: 'RESOURCE',
      }),
      {
        create: async () => {
          throw error;
        },
        resolveUser: async () => admin,
      },
    );
    expect(response.status).toBe(status);
    expect(JSON.stringify(await response.json())).not.toContain('P2002');
  });
});
