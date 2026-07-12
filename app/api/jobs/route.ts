import {
  handleCreateContent,
  type CreateRouteDependencies,
} from '@/lib/domain/content-routes';
import { createJobPost } from '@/lib/domain/content-service';
import { createJobSchema, type CreateJobInput } from '@/lib/validation/content';

export const runtime = 'nodejs';

export function handleCreateJob(
  request: Request,
  dependencies: CreateRouteDependencies<CreateJobInput> = {},
) {
  return handleCreateContent(
    request,
    createJobSchema,
    createJobPost,
    dependencies,
  );
}

export function POST(request: Request) {
  return handleCreateJob(request);
}
