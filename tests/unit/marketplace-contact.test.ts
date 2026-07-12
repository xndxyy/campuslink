import { describe, expect, it, vi } from 'vitest';

import {
  MarketplaceContactNotFoundError,
  MarketplaceContactOwnListingError,
  requestMarketplaceContact,
  type MarketplaceContactAdapter,
} from '@/lib/domain/marketplace-contact';

const actor = { campusId: 'campus_1', id: 'buyer_1' };

function adapter(sellerId = 'seller_1') {
  const order: string[] = [];
  const value = {
    $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation(value),
    ),
    auditLog: {
      create: vi.fn(async () => {
        order.push('audit');
        return { id: 'audit_1' };
      }),
    },
    marketplaceItem: {
      findFirst: vi.fn(async () => ({
        contact: 'seller@campus.example',
        id: 'market_1',
        sellerId,
      })),
    },
    order,
  };
  return value as unknown as MarketplaceContactAdapter & { order: string[] };
}

describe('marketplace contact requests', () => {
  it('rejects requesting contact for an own listing', async () => {
    const db = adapter(actor.id);
    await expect(
      requestMarketplaceContact(db, actor, 'market_1'),
    ).rejects.toBeInstanceOf(MarketplaceContactOwnListingError);
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('denies unpublished, missing, or cross-campus listings', async () => {
    const db = adapter();
    vi.mocked(db.marketplaceItem.findFirst).mockResolvedValue(null);
    await expect(
      requestMarketplaceContact(db, actor, 'market_1'),
    ).rejects.toBeInstanceOf(MarketplaceContactNotFoundError);
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('writes a minimal audit event before returning the contact', async () => {
    const db = adapter();
    const result = await requestMarketplaceContact(db, actor, 'market_1');
    db.order.push('response');

    expect(result).toEqual({ contact: 'seller@campus.example' });
    expect(db.order).toEqual(['audit', 'response']);
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: 'MARKETPLACE_CONTACT_REQUESTED',
        actorId: actor.id,
        details: { campusId: actor.campusId },
        subjectId: 'market_1',
        subjectType: 'MARKETPLACE_ITEM',
      },
      select: { id: true },
    });
    expect(
      JSON.stringify(vi.mocked(db.auditLog.create).mock.calls),
    ).not.toContain('seller@campus.example');
  });
});
