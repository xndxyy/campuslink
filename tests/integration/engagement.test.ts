import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbClient } from '@/lib/db';
import {
  addFavourite,
  listUserFavourites,
  toggleFavourite,
  type FavouritesAdapter,
} from '@/lib/domain/favourites';
import {
  requestMarketplaceContact,
  type MarketplaceContactAdapter,
} from '@/lib/domain/marketplace-contact';
import {
  createReport,
  ReportDuplicateError,
  ReportOwnContentError,
  type ReportsAdapter,
} from '@/lib/domain/reports';

const describeWithDatabase = describe.skipIf(!process.env.DATABASE_URL);

describeWithDatabase('engagement persistence', () => {
  let db: ReturnType<typeof createDbClient>;
  let campusId = '';
  let ownerId = '';
  let memberId = '';
  let marketplaceId = '';

  beforeAll(async () => {
    db = createDbClient();
    const suffix = randomUUID();
    const campus = await db.campus.create({
      data: {
        name: 'Engagement Test Campus',
        slug: `engagement-${suffix}`,
      },
    });
    campusId = campus.id;
    const [owner, member] = await Promise.all([
      db.user.create({
        data: {
          campusId,
          email: `owner@${suffix}.engagement.test`,
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      }),
      db.user.create({
        data: {
          campusId,
          email: `member@${suffix}.engagement.test`,
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      }),
    ]);
    ownerId = owner.id;
    memberId = member.id;
    const listing = await db.marketplaceItem.create({
      data: {
        campusId,
        condition: 'GOOD',
        contact: 'private-contact@campus.example',
        description: 'Published integration listing',
        pickupArea: 'Library',
        priceCents: 1000,
        sellerId: ownerId,
        status: 'PUBLISHED',
        title: 'Integration textbook',
      },
    });
    marketplaceId = listing.id;
  });

  afterAll(async () => {
    if (campusId) {
      await db.auditLog.deleteMany({
        where: { actorId: { in: [ownerId, memberId] } },
      });
      await db.report.deleteMany({
        where: { reporterId: { in: [ownerId, memberId] } },
      });
      await db.favourite.deleteMany({
        where: { userId: { in: [ownerId, memberId] } },
      });
      await db.marketplaceItem.deleteMany({ where: { campusId } });
      await db.user.deleteMany({ where: { campusId } });
      await db.campus.delete({ where: { id: campusId } });
    }
    await db.$disconnect();
  });

  it('stores a favourite exactly once and toggles it off', async () => {
    const adapter = db as unknown as FavouritesAdapter;
    const actor = { campusId, id: memberId };
    const target = {
      targetId: marketplaceId,
      targetType: 'MARKETPLACE_ITEM' as const,
    };
    await addFavourite(adapter, actor, target);
    await addFavourite(adapter, actor, target);
    await expect(
      db.favourite.count({
        where: { userId: memberId, targetId: marketplaceId },
      }),
    ).resolves.toBe(1);
    const listed = await listUserFavourites(adapter, actor, {
      page: 1,
      pageSize: 12,
    });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.targetId).toBe(marketplaceId);
    expect(listed.items[0]?.item).not.toHaveProperty('contact');
    await expect(toggleFavourite(adapter, actor, target)).resolves.toEqual({
      favourited: false,
    });
  });

  it('rejects duplicate and self reports', async () => {
    const adapter = db as unknown as ReportsAdapter;
    const verified = {
      campusId,
      emailVerifiedAt: new Date(),
      status: 'ACTIVE' as const,
    };
    const input = {
      reason: 'SPAM' as const,
      targetId: marketplaceId,
      targetType: 'MARKETPLACE_ITEM' as const,
    };
    await createReport(adapter, { ...verified, id: memberId }, input);
    await expect(
      createReport(adapter, { ...verified, id: memberId }, input),
    ).rejects.toBeInstanceOf(ReportDuplicateError);
    await expect(
      createReport(adapter, { ...verified, id: ownerId }, input),
    ).rejects.toBeInstanceOf(ReportOwnContentError);
  });

  it('returns contact only through the audited request', async () => {
    const result = await requestMarketplaceContact(
      db as unknown as MarketplaceContactAdapter,
      { campusId, id: memberId },
      marketplaceId,
    );
    expect(result).toEqual({ contact: 'private-contact@campus.example' });
    const audit = await db.auditLog.findFirst({
      where: {
        action: 'MARKETPLACE_CONTACT_REQUESTED',
        actorId: memberId,
        subjectId: marketplaceId,
      },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.details)).not.toContain(
      'private-contact@campus.example',
    );
  });
});
