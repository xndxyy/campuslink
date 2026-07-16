import {
  handleContentAction,
  handleContentDelete,
} from '@/lib/domain/content-action-route';

export const runtime = 'nodejs';

export function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return params.then(({ id }) =>
    handleContentDelete(request, 'campus-work', id),
  );
}

export function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return params.then(({ id }) =>
    handleContentAction(request, 'campus-work', id),
  );
}
