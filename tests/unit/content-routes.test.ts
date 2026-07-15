import { describe, expect, it, vi } from 'vitest';

import { POST as redirectLegacyJobCreate } from '@/app/api/jobs/route';
import { handleCreateMarketplaceItem } from '@/app/api/marketplace/route';
import { handleCreateResource } from '@/app/api/resources/route';
import { handleContentAction } from '@/lib/domain/content-action-route';
import { ContentConflictError } from '@/lib/domain/content-service';
import { ContentBlockedError } from '@/lib/moderation/content-assessment';

const user = {
  campusId: 'campus_1',
  email: 'student@campuslink.edu',
  emailVerifiedAt: new Date(),
  id: 'user_1',
  name: 'Student',
  role: 'STUDENT' as const,
  status: 'ACTIVE' as const,
};

function request(
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

const resourceBody = {
  assetIds: ['doc_1'],
  customTags: ['算法'],
  presetTagIds: [],
  summary: 'Complete lecture notes with worked examples and exercises.',
  title: 'Algorithms revision notes',
};

describe('content creation routes', () => {
  it('rejects a cross-origin request before session resolution', async () => {
    const resolveUser = vi.fn(async () => user);
    const create = vi.fn();
    const response = await handleCreateResource(
      request('/api/resources', resourceBody, 'https://attacker.example'),
      { create, resolveUser },
    );
    expect(response.status).toBe(403);
    expect(resolveUser).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('denies an unverified user', async () => {
    const response = await handleCreateResource(
      request('/api/resources', resourceBody),
      {
        create: vi.fn(),
        resolveUser: async () => ({ ...user, emailVerifiedAt: null }),
      },
    );
    expect(response.status).toBe(403);
  });

  it('rejects invalid and unknown resource input', async () => {
    const response = await handleCreateResource(
      request('/api/resources', { ...resourceBody, ownerId: 'attacker' }),
      { create: vi.fn(), resolveUser: async () => user },
    );
    expect(response.status).toBe(400);
  });

  it('passes server-owned identity into successful resource creation', async () => {
    const create = vi.fn(async () => ({ id: 'resource_1', status: 'PENDING' }));
    const response = await handleCreateResource(
      request('/api/resources', resourceBody),
      { create, resolveUser: async () => user },
    );
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(
      {
        campusId: user.campusId,
        emailVerifiedAt: user.emailVerifiedAt,
        id: user.id,
        role: user.role,
        status: user.status,
      },
      expect.objectContaining({ title: resourceBody.title }),
    );
    await expect(response.json()).resolves.toMatchObject({
      message: '内容正在人工审核。',
      status: 'PENDING',
    });
  });

  it('returns stable Chinese feedback for blocked content', async () => {
    const response = await handleCreateResource(
      request('/api/resources', resourceBody),
      {
        create: vi.fn(async () => {
          throw new ContentBlockedError({
            categories: ['广告垃圾'],
            kind: 'block',
            reasonZh: '内容包含违规推广信息',
            source: 'provider',
            suggestionZh: '删除推广链接后重新提交',
          });
        }),
        resolveUser: async () => user,
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({
      categories: ['广告垃圾'],
      code: 'CONTENT_BLOCKED',
      reason: '内容包含违规推广信息',
      suggestion: '删除推广链接后重新提交',
    });
  });

  it('maps asset conflicts without leaking internals', async () => {
    const response = await handleCreateMarketplaceItem(
      request('/api/marketplace', {
        assetIds: ['image_1'],
        condition: 'GOOD',
        contact: 'Campus inbox only',
        customTags: [],
        description: 'A carefully used discrete mathematics textbook.',
        pickupArea: 'North library',
        presetTagIds: [],
        price: '19.99',
        title: 'Discrete mathematics textbook',
      }),
      {
        create: vi.fn(async () => {
          throw new ContentConflictError('storage row lock failed');
        }),
        resolveUser: async () => user,
      },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      message: 'Content or asset state conflict.',
    });
  });

  it('redirects the legacy job writer to campus work without changing method', () => {
    const response = redirectLegacyJobCreate(
      request('/api/jobs', { title: 'Legacy client payload' }),
    );
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(
      'http://localhost/api/campus-work',
    );
  });

  it('passes the complete verified server actor into tag-aware edits', async () => {
    const edit = vi.fn(async () => ({ id: 'resource_1', status: 'DRAFT' }));
    const actionRequest = new Request(
      'http://localhost/api/resources/resource_1',
      {
        body: JSON.stringify({
          action: 'edit',
          data: {
            customTags: ['算法'],
            presetTagIds: [],
            summary:
              'Complete lecture notes with worked examples and exercises.',
            title: 'Algorithms revision notes',
          },
        }),
        headers: {
          'content-type': 'application/json',
          origin: new URL(process.env.APP_URL ?? 'http://localhost:3000')
            .origin,
        },
        method: 'PATCH',
      },
    );

    const response = await Reflect.apply(handleContentAction, undefined, [
      actionRequest,
      'resource',
      'resource_1',
      { adapter: {}, edit, resolveUser: async () => user },
    ]);

    expect(response.status).toBe(200);
    expect(edit).toHaveBeenCalledWith(
      expect.anything(),
      {
        campusId: user.campusId,
        emailVerifiedAt: user.emailVerifiedAt,
        id: user.id,
        role: user.role,
        status: user.status,
      },
      'resource',
      'resource_1',
      expect.objectContaining({ customTags: ['算法'], presetTagIds: [] }),
    );
  });
});
