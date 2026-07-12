import { describe, expect, it, vi } from 'vitest';

import { handleCreateJob } from '@/app/api/jobs/route';
import { handleCreateMarketplaceItem } from '@/app/api/marketplace/route';
import { handleCreateResource } from '@/app/api/resources/route';
import { ContentConflictError } from '@/lib/domain/content-service';

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
  origin = 'http://localhost:3000',
) {
  return new Request(`http://localhost${path}`, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin },
    method: 'POST',
  });
}

const resourceBody = {
  assetIds: ['doc_1'],
  summary: 'Complete lecture notes with worked examples and exercises.',
  tags: ['algorithms'],
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
      expect.objectContaining({ campusId: user.campusId, id: user.id }),
      expect.objectContaining({ title: resourceBody.title }),
    );
  });

  it('maps asset conflicts without leaking internals', async () => {
    const response = await handleCreateMarketplaceItem(
      request('/api/marketplace', {
        assetIds: ['image_1'],
        condition: 'GOOD',
        contact: 'Campus inbox only',
        description: 'A carefully used discrete mathematics textbook.',
        pickupArea: 'North library',
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

  it('creates a valid job without assets', async () => {
    const create = vi.fn(async () => ({ id: 'job_1', status: 'PENDING' }));
    const response = await handleCreateJob(
      request('/api/jobs', {
        company: 'Campus Cafe',
        description: 'Help serve students during the weekend lunch shift.',
        location: 'Student centre',
        payText: '$20/hour',
        title: 'Weekend assistant',
      }),
      { create, resolveUser: async () => user },
    );
    expect(response.status).toBe(201);
  });
});
