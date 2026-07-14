import { getCurrentUser } from '@/lib/auth/auth-service';
import { getDb } from '@/lib/db';

import { hasFavourite, type FavouritesAdapter } from './favourites';
import type { PublicContentKind } from './public-content';

interface OwnerLookupAdapter {
  campusWorkPost: {
    findFirst(args: Record<string, unknown>): Promise<unknown>;
  };
  marketplaceItem: {
    findFirst(args: Record<string, unknown>): Promise<unknown>;
  };
  resource: { findFirst(args: Record<string, unknown>): Promise<unknown> };
}

export async function loadEngagementViewerState(
  kind: PublicContentKind,
  id: string,
) {
  const user = await getCurrentUser();
  if (!user)
    return { initialFavourited: false, isOwner: false, signedIn: false };
  const db = getDb();
  const lookup = db as unknown as OwnerLookupAdapter;
  const targetType =
    kind === 'resource'
      ? ('RESOURCE' as const)
      : kind === 'marketplace'
        ? ('MARKETPLACE_ITEM' as const)
        : ('JOB_POST' as const);
  const ownerField = kind === 'marketplace' ? 'sellerId' : 'authorId';
  const delegate =
    kind === 'resource'
      ? lookup.resource
      : kind === 'marketplace'
        ? lookup.marketplaceItem
        : lookup.campusWorkPost;
  const [initialFavourited, owned] = await Promise.all([
    hasFavourite(
      db as unknown as FavouritesAdapter,
      { campusId: user.campusId, id: user.id },
      { targetId: id, targetType },
    ),
    delegate.findFirst({
      select: { id: true },
      where: {
        campusId: user.campusId,
        id,
        [ownerField]: user.id,
        status: 'PUBLISHED',
      },
    }),
  ]);
  return { initialFavourited, isOwner: Boolean(owned), signedIn: true };
}
