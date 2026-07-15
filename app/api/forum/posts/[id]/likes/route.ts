import { handleForumLikePost } from '@/lib/domain/forum-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export function POST(request: Request, { params }: RouteContext) {
  return params.then(({ id }) => handleForumLikePost(request, id));
}
