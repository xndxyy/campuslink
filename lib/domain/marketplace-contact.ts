export interface MarketplaceContactActor {
  campusId: string;
  id: string;
}

export interface MarketplaceContactAdapter {
  $transaction<T>(
    operation: (tx: MarketplaceContactAdapter) => Promise<T>,
    options?: { isolationLevel: 'Serializable' },
  ): Promise<T>;
  auditLog: {
    create(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  marketplaceItem: {
    findFirst(
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown> | null>;
  };
}

export class MarketplaceContactNotFoundError extends Error {
  constructor() {
    super('Published marketplace listing was not found');
  }
}

export class MarketplaceContactOwnListingError extends Error {
  constructor() {
    super('Cannot request contact for own listing');
  }
}

export async function requestMarketplaceContact(
  adapter: MarketplaceContactAdapter,
  actor: MarketplaceContactActor,
  marketplaceItemId: string,
) {
  return adapter.$transaction(
    async (tx) => {
      // Contact is selected only within this transaction and is never placed in
      // public presenters, logs, errors, URLs, or caches.
      const listing = await tx.marketplaceItem.findFirst({
        select: { contact: true, id: true, sellerId: true },
        where: {
          campusId: actor.campusId,
          id: marketplaceItemId,
          status: 'PUBLISHED',
        },
      });
      if (!listing) throw new MarketplaceContactNotFoundError();
      if (listing.sellerId === actor.id)
        throw new MarketplaceContactOwnListingError();

      await tx.auditLog.create({
        data: {
          action: 'MARKETPLACE_CONTACT_REQUESTED',
          actorId: actor.id,
          details: { campusId: actor.campusId },
          subjectId: marketplaceItemId,
          subjectType: 'MARKETPLACE_ITEM',
        },
        select: { id: true },
      });
      return { contact: String(listing.contact) };
    },
    { isolationLevel: 'Serializable' },
  );
}
