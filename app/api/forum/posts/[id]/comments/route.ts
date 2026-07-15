import {
  handleForumCommentsDelete,
  handleForumCommentsGet,
  handleForumCommentsPatch,
  handleForumCommentsPost,
} from '@/lib/domain/forum-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export function GET(request: Request, { params }: RouteContext) {
  return params.then(({ id }) => handleForumCommentsGet(request, id));
}

export function POST(request: Request, { params }: RouteContext) {
  return params.then(({ id }) => handleForumCommentsPost(request, id));
}

export function PATCH(request: Request, { params }: RouteContext) {
  return params.then(({ id }) => handleForumCommentsPatch(request, id));
}

export function DELETE(request: Request, { params }: RouteContext) {
  return params.then(({ id }) => handleForumCommentsDelete(request, id));
}
