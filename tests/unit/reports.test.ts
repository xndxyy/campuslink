import { describe, expect, it, vi } from 'vitest';

import {
  createReport,
  listReporterReports,
  ReportDuplicateError,
  ReportNotFoundError,
  ReportOwnContentError,
  type ReportsAdapter,
} from '@/lib/domain/reports';

const actor = { campusId: 'campus_1', id: 'user_1' };
const input = {
  details: 'This listing redirects students to a suspicious payment page.',
  reason: 'PROHIBITED' as const,
  targetId: 'market_1',
  targetType: 'MARKETPLACE_ITEM' as const,
};

function adapter(ownerId = 'seller_1') {
  const value = {
    $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation(value),
    ),
    jobPost: { findFirst: vi.fn(async () => null) },
    marketplaceItem: {
      findFirst: vi.fn(async () => ({ sellerId: ownerId })),
    },
    report: {
      create: vi.fn(async () => ({
        createdAt: new Date('2026-07-12T12:00:00Z'),
        id: 'report_1',
        status: 'OPEN',
      })),
      findMany: vi.fn(async () => []),
    },
    resource: { findFirst: vi.fn(async () => null) },
  };
  return value as unknown as ReportsAdapter;
}

describe('reports domain', () => {
  it('rejects reporting own content with the exact message', async () => {
    await expect(createReport(adapter(actor.id), actor, input)).rejects.toEqual(
      new ReportOwnContentError(),
    );
    await expect(createReport(adapter(actor.id), actor, input)).rejects.toThrow(
      'Cannot report own content',
    );
  });

  it('denies hidden, unpublished, missing, or cross-campus targets', async () => {
    const db = adapter();
    vi.mocked(db.marketplaceItem.findFirst).mockResolvedValue(null);
    await expect(createReport(db, actor, input)).rejects.toBeInstanceOf(
      ReportNotFoundError,
    );
    expect(db.report.create).not.toHaveBeenCalled();
  });

  it('creates an OPEN report without accepting owner, status, or assignee', async () => {
    const db = adapter();
    await createReport(db, actor, input);
    expect(db.report.create).toHaveBeenCalledWith({
      data: {
        details: input.details,
        reason: input.reason,
        reporterId: actor.id,
        status: 'OPEN',
        targetId: input.targetId,
        targetType: input.targetType,
      },
      select: { createdAt: true, id: true, status: true },
    });
  });

  it.each([
    { code: 'P2002' },
    { code: '23505', constraint: 'Report_open_unique' },
  ])('maps duplicate OPEN report races to a conflict', async (error) => {
    const db = adapter();
    vi.mocked(db.report.create).mockRejectedValue(error);
    await expect(createReport(db, actor, input)).rejects.toBeInstanceOf(
      ReportDuplicateError,
    );
  });

  it('returns reporter-safe status and a neutral public outcome only', async () => {
    const db = adapter();
    vi.mocked(db.report.findMany).mockResolvedValue([
      {
        createdAt: new Date('2026-07-12T12:00:00Z'),
        id: 'report_1',
        status: 'TRIAGED',
        targetId: input.targetId,
        targetType: input.targetType,
        updatedAt: new Date('2026-07-12T13:00:00Z'),
      },
    ]);
    const reports = await listReporterReports(db, actor, {
      page: 1,
      pageSize: 10,
    });
    expect(reports.items[0]).toEqual(
      expect.objectContaining({
        outcome: 'Your report is under review.',
        status: 'TRIAGED',
      }),
    );
    expect(reports.items[0]).not.toHaveProperty('assigneeId');
    expect(reports.items[0]).not.toHaveProperty('reason');
    expect(reports.items[0]).not.toHaveProperty('details');
  });
});
