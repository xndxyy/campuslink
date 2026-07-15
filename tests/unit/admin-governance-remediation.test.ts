import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const auditFindMany = vi.fn();
  const resourceFindMany = vi.fn();
  return {
    auditFindMany,
    db: {
      auditLog: { findMany: auditFindMany },
      contentAssessment: { findMany: vi.fn(async () => []) },
      forumComment: { findMany: vi.fn(async () => []) },
      forumPost: { findMany: vi.fn(async () => []) },
      jobPost: { findMany: vi.fn(async () => []) },
      marketplaceItem: { findMany: vi.fn(async () => []) },
      moderationAction: {
        create: vi.fn(),
        findMany: vi.fn(async () => []),
      },
      report: {
        findFirst: vi.fn(),
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(),
      },
      resource: { findMany: resourceFindMany },
    },
    requireRole: vi.fn(),
    resourceFindMany,
  };
});

vi.mock('@/lib/db', () => ({ getDb: () => mocks.db }));
vi.mock('@/lib/auth/guards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/guards')>();
  return { ...actual, requireRole: mocks.requireRole };
});

import { GET as getAuditLog } from '@/app/api/admin/audit-log/route';
import { GET as getModerationQueue } from '@/app/api/admin/moderation/route';

const admin = {
  campusId: 'campus_1',
  email: 'admin@example.edu',
  emailVerifiedAt: new Date(),
  id: 'admin_1',
  name: 'Admin',
  role: 'ADMIN' as const,
  status: 'ACTIVE' as const,
};

describe('admin governance route remediation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue(admin);
    mocks.resourceFindMany.mockResolvedValue([
      {
        assets: [
          {
            contentType: 'application/pdf',
            id: 'asset_1',
            kind: 'RESOURCE_DOCUMENT',
            sizeBytes: BigInt('4096'),
          },
        ],
        author: { id: 'author_1', name: 'Author' },
        createdAt: new Date('2026-07-12T10:00:00Z'),
        id: 'resource_1',
        status: 'PUBLISHED',
        title: 'Published resource',
        updatedAt: new Date('2026-07-12T10:00:00Z'),
      },
    ]);
    mocks.auditFindMany.mockResolvedValue([
      {
        action: 'CONTENT_APPROVED',
        actorId: 'moderator_1',
        createdAt: new Date('2026-07-12T10:00:00Z'),
        details: { reason: 'safe' },
        id: 'audit_2',
        subjectId: 'resource_1',
        subjectType: 'RESOURCE',
      },
      {
        action: 'CONTENT_APPROVED',
        actorId: 'moderator_1',
        createdAt: new Date('2026-07-12T09:00:00Z'),
        details: { reason: 'safe' },
        id: 'audit_1',
        subjectId: 'resource_1',
        subjectType: 'RESOURCE',
      },
    ]);
  });

  it('returns a JSON-safe status queue with decimal asset sizes', async () => {
    const response = await (
      getModerationQueue as unknown as (request: Request) => Promise<Response>
    )(new Request('http://localhost/api/admin/moderation?status=PUBLISHED'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [
        {
          assets: [{ sizeBytes: '4096' }],
          id: 'resource_1',
          status: 'PUBLISHED',
        },
      ],
    });
    expect(mocks.resourceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campusId: admin.campusId, status: 'PUBLISHED' },
      }),
    );
  });

  it('strictly maps audit filters, campus scope, page size, and cursor', async () => {
    const cursor = Buffer.from(
      JSON.stringify({
        createdAt: '2026-07-12T11:00:00.000Z',
        id: 'audit_3',
      }),
    ).toString('base64url');
    const response = await getAuditLog(
      new Request(
        `http://localhost/api/admin/audit-log?actor=moderator_1&event=CONTENT_APPROVED&entityType=RESOURCE&entityId=resource_1&from=2026-07-12T00%3A00%3A00.000Z&to=2026-07-13T00%3A00%3A00.000Z&pageSize=1&cursor=${cursor}`,
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.auditFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
        where: expect.objectContaining({
          action: 'CONTENT_APPROVED',
          actorId: 'moderator_1',
          campusId: admin.campusId,
          subjectId: 'resource_1',
          subjectType: 'RESOURCE',
        }),
      }),
    );
    const body = await response.json();
    expect(body.hasNextPage).toBe(true);
    expect(body.nextCursor).toEqual(expect.any(String));
  });

  it.each([
    'from=not-a-date',
    'pageSize=0',
    'pageSize=101',
    'pageSize=1.5',
    'entityType=NOT_REAL',
    'cursor=not-base64-json',
    'unknown=value',
  ])('returns 400 for invalid strict audit query %s', async (query) => {
    const response = await getAuditLog(
      new Request(`http://localhost/api/admin/audit-log?${query}`),
    );
    expect(response.status).toBe(400);
    expect(mocks.auditFindMany).not.toHaveBeenCalled();
  });
});
