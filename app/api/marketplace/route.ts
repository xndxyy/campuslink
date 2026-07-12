import {
  handleCreateContent,
  type CreateRouteDependencies,
} from '@/lib/domain/content-routes';
import { createMarketplaceItem } from '@/lib/domain/content-service';
import {
  createMarketplaceItemSchema,
  type CreateMarketplaceItemInput,
} from '@/lib/validation/content';

export const runtime = 'nodejs';

export function handleCreateMarketplaceItem(
  request: Request,
  dependencies: CreateRouteDependencies<CreateMarketplaceItemInput> = {},
) {
  return handleCreateContent(
    request,
    createMarketplaceItemSchema,
    createMarketplaceItem,
    dependencies,
  );
}

export function POST(request: Request) {
  return handleCreateMarketplaceItem(request);
}
