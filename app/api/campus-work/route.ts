import {
  handleCreateContent,
  type CreateRouteDependencies,
} from '@/lib/domain/content-routes';
import { createCampusWorkPost } from '@/lib/domain/content-service';
import {
  createCampusWorkSchema,
  type CreateCampusWorkInput,
} from '@/lib/validation/content';

export const runtime = 'nodejs';

export function handleCreateCampusWork(
  request: Request,
  dependencies: CreateRouteDependencies<CreateCampusWorkInput> = {},
) {
  return handleCreateContent(
    request,
    createCampusWorkSchema,
    createCampusWorkPost,
    dependencies,
  );
}

export function POST(request: Request) {
  return handleCreateCampusWork(request);
}
