import { z } from 'zod';

import { requireRole, type CurrentUserResolver } from '@/lib/auth/guards';
import { isSameOriginAuthRequest } from '@/lib/auth/request-security';
import { getDb } from '@/lib/db';
import { adminErrorResponse, adminJson } from '@/lib/domain/admin-route';
import {
  listPendingContent,
  moderateContent,
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
    const parsed = mutationSchema.safeParse(
      await request.json().catch(() => null),
    );
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

export async function GET() {
  try {
    const user = await requireRole(['MODERATOR', 'ADMIN']);
    const items = await listPendingContent(
      getDb() as unknown as ModerationAdapter,
      { campusId: user.campusId, id: user.id, role: user.role },
    );
    return adminJson({ items });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export function POST(request: Request) {
  return handleModerationMutation(request);
}
