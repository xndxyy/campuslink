import { handleContentAction } from '@/lib/domain/content-action-route';
export function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return params.then(({ id }) => handleContentAction(request, 'resource', id));
}
