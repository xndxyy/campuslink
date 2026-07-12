import { describe, expect, it, vi } from 'vitest';

import { handleModerationMutation } from '@/app/api/admin/moderation/route';
import { handleUserMutation } from '@/app/api/admin/users/route';
import { ModerationConflictError } from '@/lib/domain/moderation';
import { AdminConflictError } from '@/lib/domain/administration';

const moderator = {
  campusId: 'campus_1',
  email: 'moderator@example.edu',
  emailVerifiedAt: new Date(),
  id: 'moderator_1',
  name: 'Moderator',
  role: 'MODERATOR' as const,
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

describe('admin mutation route protections', () => {
  it('rejects cross-origin requests before resolving a session', async () => {
    const resolveUser = vi.fn(async () => moderator);
    const mutate = vi.fn();
    const response = await handleModerationMutation(
      request(
        '/api/admin/moderation',
        {
          action: 'APPROVE',
          reason: 'Meets campus policy.',
          subjectId: 'resource_1',
          subjectType: 'RESOURCE',
        },
        'https://attacker.example',
      ),
      { mutate, resolveUser },
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(resolveUser).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('returns a safe conflict without leaking target existence or database details', async () => {
    const response = await handleModerationMutation(
      request('/api/admin/moderation', {
        action: 'APPROVE',
        reason: 'Meets campus policy.',
        subjectId: 'resource_1',
        subjectType: 'RESOURCE',
      }),
      {
        mutate: vi.fn(async () => {
          throw new ModerationConflictError('database row no longer exists');
        }),
        resolveUser: async () => moderator,
      },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      message: 'Moderation state conflict.',
    });
  });

  it('returns 400 for unknown fields and invalid reasons', async () => {
    const response = await handleModerationMutation(
      request('/api/admin/moderation', {
        action: 'REJECT',
        ownerId: 'attacker',
        reason: 'no',
        subjectId: 'resource_1',
        subjectType: 'RESOURCE',
      }),
      { mutate: vi.fn(), resolveUser: async () => moderator },
    );
    expect(response.status).toBe(400);
  });

  it('returns the same 403 boundary for students without target disclosure', async () => {
    const mutate = vi.fn();
    const response = await handleModerationMutation(
      request('/api/admin/moderation', {
        action: 'HIDE',
        reason: 'Violates campus policy.',
        subjectId: 'secret_resource',
        subjectType: 'RESOURCE',
      }),
      {
        mutate,
        resolveUser: async () => ({ ...moderator, role: 'STUDENT' }),
      },
    );
    expect(response.status).toBe(403);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('restricts user management to administrators', async () => {
    const mutate = vi.fn();
    const response = await handleUserMutation(
      request('/api/admin/users', {
        reason: 'Role required for campus operations.',
        role: 'ADMIN',
        userId: 'user_1',
      }),
      { mutate, resolveUser: async () => moderator },
    );
    expect(response.status).toBe(403);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('maps campus domain uniqueness conflicts to 409 without database details', async () => {
    const response = await handleUserMutation(
      request('/api/admin/users', {
        reason: 'Campus governance update.',
        role: 'STUDENT',
        userId: 'user_1',
      }),
      {
        mutate: vi.fn(async () => {
          throw new AdminConflictError('Unique constraint P2002');
        }),
        resolveUser: async () => ({ ...moderator, role: 'ADMIN' }),
      },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      message: 'Administration state conflict.',
    });
  });
});
