import {
  handleForumPostCollectionGet,
  handleForumPostCollectionPost,
} from '@/lib/domain/forum-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return handleForumPostCollectionGet(request);
}

export function POST(request: Request) {
  return handleForumPostCollectionPost(request);
}
