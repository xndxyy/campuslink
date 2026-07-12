import {
  handleFavouriteDelete,
  handleFavouritePost,
} from '@/lib/domain/engagement-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  return handleFavouritePost(request);
}

export function DELETE(request: Request) {
  return handleFavouriteDelete(request);
}
