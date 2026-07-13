import { describe, expect, it, vi } from 'vitest';

import * as userRoute from '@/app/api/admin/users/route';
import { handleModerationMutation } from '@/app/api/admin/moderation/route';
import { handleUserMutation } from '@/app/api/admin/users/route';
import { ModerationConflictError } from '@/lib/domain/moderation';
import { AdminConflictError } from '@/lib/domain/administration';
import {
  getSessionCookieName,
  getSessionCookieOptions,
} from '@/lib/auth/session';

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
  origin = new URL(process.env.APP_URL ?? 'http://localhost:3000').origin,
) {
  return new Request(`http://localhost${path}`, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin },
    method: 'POST',
  });
}

function handleUserGet() {
  const handler = (
    userRoute as unknown as {
      handleUserGet?: (
        request: Request,
        dependencies: Record<string, unknown>,
      ) => Promise<Response>;
    }
  ).handleUserGet;
  expect(handler).toBeTypeOf('function');
  return handler!;
}

describe('admin user GET route', () => {
  it('parses list filters without passing UI state into the list query', async () => {
    const list = vi.fn(async () => ({
      counts: { active: 1, staff: 1, suspended: 0, total: 1, unverified: 0 },
      hasNextPage: false,
      items: [],
      nextCursor: null,
    }));
    const detail = vi.fn();
    const response = await handleUserGet()(
      new Request(
        'http://localhost/api/admin/users?search=Alice&role=ADMIN&status=ACTIVE&verified=true&pageSize=10&tab=audit',
      ),
      {
        detail,
        list,
        resolveUser: async () => ({ ...moderator, role: 'ADMIN' }),
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ campusId: 'campus_1', role: 'ADMIN' }),
      {
        pageSize: 10,
        role: 'ADMIN',
        search: 'Alice',
        status: 'ACTIVE',
        verified: true,
      },
    );
    expect(detail).not.toHaveBeenCalled();
  });

  it('loads selected same-campus detail without polluting it with list filters', async () => {
    const detail = vi.fn(async () => ({ overview: { id: 'user_1' } }));
    const list = vi.fn();
    const response = await handleUserGet()(
      new Request(
        'http://localhost/api/admin/users?search=Alice&cursor=eyJpbnZhbGlkIjp0cnVlfQ&user=user_1&tab=submissions',
      ),
      {
        detail,
        list,
        resolveUser: async () => ({ ...moderator, role: 'ADMIN' }),
      },
    );
    expect(response.status).toBe(400);
    expect(detail).not.toHaveBeenCalled();

    const validResponse = await handleUserGet()(
      new Request(
        'http://localhost/api/admin/users?search=Alice&user=user_1&tab=submissions',
      ),
      {
        detail,
        list,
        resolveUser: async () => ({ ...moderator, role: 'ADMIN' }),
      },
    );
    expect(validResponse.status).toBe(200);
    expect(detail).toHaveBeenCalledWith(
      expect.objectContaining({ campusId: 'campus_1', role: 'ADMIN' }),
      'user_1',
    );
    expect(list).not.toHaveBeenCalled();
    await expect(validResponse.json()).resolves.toEqual({
      detail: { overview: { id: 'user_1' } },
      tab: 'submissions',
    });
  });

  it.each([
    'unknown=value',
    'role=ADMIN&role=MODERATOR',
    'cursor=not-a-cursor',
  ])('rejects an invalid query before a data lookup: %s', async (query) => {
    const list = vi.fn();
    const detail = vi.fn();
    const response = await handleUserGet()(
      new Request(`http://localhost/api/admin/users?${query}`),
      {
        detail,
        list,
        resolveUser: async () => ({ ...moderator, role: 'ADMIN' }),
      },
    );
    expect(response.status).toBe(400);
    expect(list).not.toHaveBeenCalled();
    expect(detail).not.toHaveBeenCalled();
  });
});

describe('admin mutation route protections', () => {
  it.each([
    {
      body: {
        action: 'REVOKE_SESSIONS',
        reason: 'Self sign-out requested after a security review.',
        userId: moderator.id,
      },
      result: { revokedCount: 1 },
      useRevoke: true,
    },
    {
      body: {
        action: 'SET_ROLE',
        reason: 'Administrator completes their governance handoff.',
        role: 'MODERATOR',
        userId: moderator.id,
      },
      result: { role: 'MODERATOR', sessionsRevoked: true },
      useRevoke: false,
    },
    {
      body: {
        action: 'SET_STATUS',
        reason: 'Administrator suspends their own account after review.',
        status: 'SUSPENDED',
        userId: moderator.id,
      },
      result: { sessionsRevoked: true, status: 'SUSPENDED' },
      useRevoke: false,
    },
  ])(
    'clears the current cookie only after successful self revocation: $body.action',
    async ({ body, result, useRevoke }) => {
      const mutate = vi.fn(async () => result);
      const revoke = vi.fn(async () => result);
      const response = await handleUserMutation(
        request('/api/admin/users', body),
        {
          mutate,
          resolveUser: async () => ({ ...moderator, role: 'ADMIN' }),
          revoke,
        },
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ...result,
        selfRevoked: true,
      });
      expect(useRevoke ? revoke : mutate).toHaveBeenCalledOnce();
      const cookie = response.headers.get('set-cookie');
      expect(cookie).toContain(`${getSessionCookieName()}=`);
      expect(cookie).toContain('Max-Age=0');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=lax');
      if (getSessionCookieOptions().secure) expect(cookie).toContain('Secure');
      else expect(cookie).not.toContain('Secure');
    },
  );

  it('does not clear the current cookie for another managed user', async () => {
    const response = await handleUserMutation(
      request('/api/admin/users', {
        action: 'REVOKE_SESSIONS',
        reason: 'Another user must sign out after a security review.',
        userId: 'user_1',
      }),
      {
        resolveUser: async () => ({ ...moderator, role: 'ADMIN' }),
        revoke: vi.fn(async () => ({ revokedCount: 2 })),
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      revokedCount: 2,
      selfRevoked: false,
    });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('does not clear the current cookie when self revocation conflicts', async () => {
    const response = await handleUserMutation(
      request('/api/admin/users', {
        action: 'REVOKE_SESSIONS',
        reason: 'Conflicting self sign-out must not clear the cookie.',
        userId: moderator.id,
      }),
      {
        resolveUser: async () => ({ ...moderator, role: 'ADMIN' }),
        revoke: vi.fn(async () => {
          throw new AdminConflictError();
        }),
      },
    );
    expect(response.status).toBe(409);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

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
        action: 'SET_ROLE',
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
        action: 'SET_ROLE',
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

  it('dispatches strict role, status, and session actions without ambiguous fields', async () => {
    const adminUser = { ...moderator, role: 'ADMIN' as const };
    const mutate = vi.fn(async () => ({ updated: true }));
    const revoke = vi.fn(async () => ({ revokedCount: 2 }));

    const roleResponse = await handleUserMutation(
      request('/api/admin/users', {
        action: 'SET_ROLE',
        reason: 'Role required for current campus operations.',
        role: 'MODERATOR',
        userId: 'user_1',
      }),
      { mutate, resolveUser: async () => adminUser, revoke },
    );
    expect(roleResponse.status).toBe(200);
    expect(mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: 'ADMIN' }),
      {
        reason: 'Role required for current campus operations.',
        role: 'MODERATOR',
        userId: 'user_1',
      },
    );

    const statusResponse = await handleUserMutation(
      request('/api/admin/users', {
        action: 'SET_STATUS',
        reason: 'Account restored after completed campus review.',
        status: 'ACTIVE',
        userId: 'user_1',
      }),
      { mutate, resolveUser: async () => adminUser, revoke },
    );
    expect(statusResponse.status).toBe(200);
    expect(mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: 'ADMIN' }),
      {
        reason: 'Account restored after completed campus review.',
        status: 'ACTIVE',
        userId: 'user_1',
      },
    );

    const callsBeforePending = mutate.mock.calls.length;
    const pendingResponse = await handleUserMutation(
      request('/api/admin/users', {
        action: 'SET_STATUS',
        reason: 'Administrators cannot reset verification state.',
        status: 'PENDING_VERIFICATION',
        userId: 'user_1',
      }),
      { mutate, resolveUser: async () => adminUser, revoke },
    );
    expect(pendingResponse.status).toBe(400);
    expect(mutate).toHaveBeenCalledTimes(callsBeforePending);

    const revokeResponse = await handleUserMutation(
      request('/api/admin/users', {
        action: 'REVOKE_SESSIONS',
        reason: 'Security review requires a complete device sign-out.',
        userId: 'user_1',
      }),
      { mutate, resolveUser: async () => adminUser, revoke },
    );
    expect(revokeResponse.status).toBe(200);
    expect(revoke).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'ADMIN' }),
      {
        reason: 'Security review requires a complete device sign-out.',
        userId: 'user_1',
      },
    );

    const ambiguousResponse = await handleUserMutation(
      request('/api/admin/users', {
        action: 'SET_ROLE',
        reason: 'Ambiguous requests must be rejected safely.',
        role: 'MODERATOR',
        status: 'ACTIVE',
        userId: 'user_1',
      }),
      { mutate, resolveUser: async () => adminUser, revoke },
    );
    expect(ambiguousResponse.status).toBe(400);
  });

  it('rejects cross-origin user mutations before authentication', async () => {
    const resolveUser = vi.fn(async () => ({
      ...moderator,
      role: 'ADMIN' as const,
    }));
    const mutate = vi.fn();
    const response = await handleUserMutation(
      request(
        '/api/admin/users',
        {
          action: 'SET_STATUS',
          reason: 'Cross-origin request must not reach authentication.',
          status: 'SUSPENDED',
          userId: 'user_1',
        },
        'https://attacker.example',
      ),
      { mutate, resolveUser },
    );
    expect(response.status).toBe(403);
    expect(resolveUser).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });
});
