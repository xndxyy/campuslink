import { z } from 'zod';

import { requireRole, type CurrentUserResolver } from '@/lib/auth/guards';
import { isSameOriginAuthRequest } from '@/lib/auth/request-security';
import { getDb } from '@/lib/db';
import { adminErrorResponse, adminJson } from '@/lib/domain/admin-route';
import { JsonBodyError, readBoundedJson } from '@/lib/security/request-body';
import {
  listModerationContent,
  moderateContent,
  toModerationQueueDto,
  type ModerationAdapter,
  type StaffActor,
} from '@/lib/domain/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const mutationSchema = z
  .object({
    action: z.enum(['APPROVE', 'REJECT', 'HIDE', 'RESTORE', 'ARCHIVE']),
    reason: z.string().trim().min(5).max(1000),
    subjectId: z.string().trim().min(1).max(191),
    subjectType: z.enum(['RESOURCE', 'MARKETPLACE_ITEM', 'JOB_POST']),
  })
  .strict();

interface ModerationRouteDependencies {
  mutate?: (
    actor: StaffActor,
    input: z.infer<typeof mutationSchema>,
  ) => Promise<unknown>;
  resolveUser?: CurrentUserResolver;
}

export async function handleModerationMutation(
  request: Request,
  dependencies: ModerationRouteDependencies = {},
) {
  if (!isSameOriginAuthRequest(request)) {
    return adminJson({ message: 'Invalid request origin.' }, { status: 403 });
  }
  try {
    const user = await requireRole(
      ['MODERATOR', 'ADMIN'],
      dependencies.resolveUser,
    );
    const body = await readBoundedJson(request).catch((error) => error);
    if (body instanceof JsonBodyError) {
      return adminJson(
        { message: 'Invalid moderation request.' },
        { status: body.status },
      );
    }
    const parsed = mutationSchema.safeParse(body);
    if (!parsed.success) {
      return adminJson(
        { message: 'Invalid moderation request.' },
        { status: 400 },
      );
    }
    const actor = { campusId: user.campusId, id: user.id, role: user.role };
    const result = dependencies.mutate
      ? await dependencies.mutate(actor, parsed.data)
      : await moderateContent(
          getDb() as unknown as ModerationAdapter,
          actor,
          parsed.data,
        );
    return adminJson(result);
  } catch (error) {
    return adminErrorResponse(error);
  }
}

const queueSchema = z
  .object({
    pageSize: z.coerce.number().int().min(1).max(200).optional(),
    status: z.enum(['PENDING', 'PUBLISHED', 'HIDDEN']).default('PENDING'),
  })
  .strict();

export async function GET(request: Request) {
  try {
    const user = await requireRole(['MODERATOR', 'ADMIN']);
    const parsed = queueSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) {
      return adminJson(
        { message: 'Invalid moderation queue request.' },
        { status: 400 },
      );
    }
    const items = await listModerationContent(
      getDb() as unknown as ModerationAdapter,
      { campusId: user.campusId, id: user.id, role: user.role },
      parsed.data,
    );
    return adminJson({ items: toModerationQueueDto(items) });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export function POST(request: Request) {
  return handleModerationMutation(request);
}
