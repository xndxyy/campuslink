import {
  handleForumPostDetailDelete,
  handleForumPostDetailGet,
  handleForumPostDetailPatch,
} from '@/lib/domain/forum-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export function GET(request: Request, { params }: RouteContext) {
  return params.then(({ id }) => handleForumPostDetailGet(request, id));
}

export function PATCH(request: Request, { params }: RouteContext) {
  return params.then(({ id }) => handleForumPostDetailPatch(request, id));
}

export function DELETE(request: Request, { params }: RouteContext) {
  return params.then(({ id }) => handleForumPostDetailDelete(request, id));
}
