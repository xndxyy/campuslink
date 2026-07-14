import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  type CampusWorkContactAdapter,
  CampusWorkContactNotFoundError,
  CampusWorkContactOwnListingError,
  requestCampusWorkContact,
} from '@/lib/domain/campus-work-contact';
import * as engagementRoutes from '@/lib/domain/engagement-routes';

const path = fileURLToPath(
  new URL('../../lib/domain/campus-work-contact.ts', import.meta.url),
);
const source = existsSync(path) ? readFileSync(path, 'utf8') : '';

describe('campus work contact domain contract', () => {
  it('defines a dedicated audited contact service', () => {
    expect(source).toContain('export async function requestCampusWorkContact');
    expect(source).toContain('CampusWorkContactNotFoundError');
    expect(source).toContain('CampusWorkContactOwnListingError');
    expect(source).toContain('CAMPUS_WORK_CONTACT_VIEWED');
  });
});

const actor = { campusId: 'campus_1', id: 'viewer_1' };

function contactAdapter(
  listing: Record<string, unknown> | null = {
    authorId: 'owner_1',
    contact: 'owner@example.edu',
    id: 'work_1',
  },
) {
  const order: string[] = [];
  const value = {
    $transaction: vi.fn(
      async (operation: (tx: CampusWorkContactAdapter) => Promise<unknown>) =>
        operation(value as unknown as CampusWorkContactAdapter),
    ),
    auditLog: {
      create: vi.fn(async () => {
        order.push('audit');
        return { id: 'audit_1' };
      }),
    },
    campusWorkPost: {
      findFirst: vi.fn(async () => listing),
    },
    order,
  };
  return value as unknown as CampusWorkContactAdapter & { order: string[] };
}

describe('campus work contact reveal', () => {
  it('audits a minimal event before returning the contact', async () => {
    const adapter = contactAdapter();
    const result = await requestCampusWorkContact(adapter, actor, 'work_1');
    adapter.order.push('response');

    expect(result).toEqual({ contact: 'owner@example.edu' });
    expect(adapter.order).toEqual(['audit', 'response']);
    expect(adapter.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(adapter.campusWorkPost.findFirst).toHaveBeenCalledWith({
      select: { authorId: true, contact: true, id: true },
      where: {
        campusId: actor.campusId,
        id: 'work_1',
        status: 'PUBLISHED',
      },
    });
    expect(adapter.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: 'CAMPUS_WORK_CONTACT_VIEWED',
        actorId: actor.id,
        campusId: actor.campusId,
        subjectId: 'work_1',
        subjectType: 'JOB_POST',
      },
      select: { id: true },
    });
    expect(
      JSON.stringify(vi.mocked(adapter.auditLog.create).mock.calls),
    ).not.toContain('owner@example.edu');
  });

  it('rejects an owner without auditing', async () => {
    const adapter = contactAdapter({
      authorId: actor.id,
      contact: 'private@example.edu',
      id: 'work_1',
    });

    await expect(
      requestCampusWorkContact(adapter, actor, 'work_1'),
    ).rejects.toBeInstanceOf(CampusWorkContactOwnListingError);
    expect(adapter.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ['missing, unpublished, or cross-campus target', null],
    [
      'published target without a contact',
      { authorId: 'owner_1', contact: null, id: 'work_1' },
    ],
  ])('rejects a %s without auditing', async (_case, listing) => {
    const adapter = contactAdapter(listing);

    await expect(
      requestCampusWorkContact(adapter, actor, 'work_1'),
    ).rejects.toBeInstanceOf(CampusWorkContactNotFoundError);
    expect(adapter.auditLog.create).not.toHaveBeenCalled();
  });
});

const routeUser = {
  campusId: actor.campusId,
  email: 'viewer@example.edu',
  emailVerifiedAt: new Date('2026-07-14T00:00:00Z'),
  id: actor.id,
  name: 'Viewer',
  role: 'STUDENT' as const,
  status: 'ACTIVE' as const,
};

function contactRequest(origin = 'http://localhost:3000') {
  return new Request('http://localhost/api/campus-work/work_1/contact', {
    headers: { origin },
    method: 'POST',
  });
}

type CampusWorkContactHandler = (
  request: Request,
  id: string,
  dependencies?: {
    contact?: (actor: { campusId: string; id: string }, id: string) => unknown;
    limiter?: {
      consume(key: string): Promise<{
        allowed: boolean;
        retryAfterSeconds: number;
      }>;
    };
    resolveUser?: () => Promise<typeof routeUser | null>;
  },
) => Promise<Response>;

describe('campus work contact route', () => {
  const handler = (
    engagementRoutes as unknown as {
      handleCampusWorkContactPost?: CampusWorkContactHandler;
    }
  ).handleCampusWorkContactPost;

  it('rejects cross-origin requests before authentication', async () => {
    expect(handler).toBeTypeOf('function');
    if (!handler) return;
    const resolveUser = vi.fn(async () => routeUser);
    const response = await handler(
      contactRequest('https://attacker.example'),
      'work_1',
      { contact: vi.fn(), resolveUser },
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(resolveUser).not.toHaveBeenCalled();
  });

  it('passes only the verified server actor and returns private no-store contact', async () => {
    expect(handler).toBeTypeOf('function');
    if (!handler) return;
    const contact = vi.fn(async () => ({ contact: 'owner@example.edu' }));
    const response = await handler(contactRequest(), 'work_1', {
      contact,
      limiter: {
        consume: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
      },
      resolveUser: async () => routeUser,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('cache-control')).toContain('no-store');
    await expect(response.json()).resolves.toEqual({
      contact: 'owner@example.edu',
    });
    expect(contact).toHaveBeenCalledWith(
      { campusId: routeUser.campusId, id: routeUser.id },
      'work_1',
    );
  });

  it('maps authentication, verification, own-listing, missing, invalid-id, and rate-limit errors', async () => {
    expect(handler).toBeTypeOf('function');
    if (!handler) return;

    const unauthenticated = await handler(contactRequest(), 'work_1', {
      resolveUser: async () => null,
    });
    const unverified = await handler(contactRequest(), 'work_1', {
      resolveUser: async () =>
        ({
          ...routeUser,
          emailVerifiedAt: null,
          status: 'PENDING_VERIFICATION',
        }) as never,
    });
    const own = await handler(contactRequest(), 'work_1', {
      contact: async () => {
        throw new CampusWorkContactOwnListingError();
      },
      limiter: {
        consume: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
      },
      resolveUser: async () => routeUser,
    });
    const missing = await handler(contactRequest(), 'work_1', {
      contact: async () => {
        throw new CampusWorkContactNotFoundError();
      },
      limiter: {
        consume: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
      },
      resolveUser: async () => routeUser,
    });
    const invalid = await handler(contactRequest(), '../secret', {
      resolveUser: async () => routeUser,
    });
    const limitedContact = vi.fn();
    const limited = await handler(contactRequest(), 'work_1', {
      contact: limitedContact,
      limiter: {
        consume: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 30 })),
      },
      resolveUser: async () => routeUser,
    });

    expect(unauthenticated.status).toBe(401);
    expect(unverified.status).toBe(403);
    expect(own.status).toBe(403);
    expect(missing.status).toBe(404);
    expect(invalid.status).toBe(400);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('30');
    expect(limitedContact).not.toHaveBeenCalled();
    await expect(own.json()).resolves.toEqual({
      message: '不能查看自己发布内容的联系方式。',
    });
    await expect(missing.json()).resolves.toEqual({
      message: '未找到可联系的已发布校园工作。',
    });
    await expect(limited.json()).resolves.toEqual({
      message: '请求过于频繁，请稍后再试。',
    });
  });

  it('does not leak contact or database details from unexpected errors', async () => {
    expect(handler).toBeTypeOf('function');
    if (!handler) return;
    const response = await handler(contactRequest(), 'work_1', {
      contact: async () => {
        throw new Error('database password owner@example.edu');
      },
      limiter: {
        consume: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
      },
      resolveUser: async () => routeUser,
    });

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain('暂时无法获取联系方式，请稍后重试。');
    expect(body).not.toContain('password');
    expect(body).not.toContain('owner@example.edu');
  });
});
