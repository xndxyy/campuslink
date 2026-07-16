import {
  handleContentAction,
  handleContentDelete,
} from '@/lib/domain/content-action-route';
export function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return params.then(({ id }) => handleContentDelete(request, 'resource', id));
}
export function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return params.then(({ id }) => handleContentAction(request, 'resource', id));
}
