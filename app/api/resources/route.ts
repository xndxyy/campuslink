import {
  handleCreateContent,
  type CreateRouteDependencies,
} from '@/lib/domain/content-routes';
import { createResource } from '@/lib/domain/content-service';
import {
  createResourceSchema,
  type CreateResourceInput,
} from '@/lib/validation/content';

export const runtime = 'nodejs';

export function handleCreateResource(
  request: Request,
  dependencies: CreateRouteDependencies<CreateResourceInput> = {},
) {
  return handleCreateContent(
    request,
    createResourceSchema,
    (adapter, actor, input, publishing) =>
      createResource(adapter, actor, input, undefined, publishing),
    dependencies,
  );
}

export function POST(request: Request) {
  return handleCreateResource(request);
}
