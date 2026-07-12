import { z } from 'zod';

import { requireRole, type CurrentUserResolver } from '@/lib/auth/guards';
import { isSameOriginAuthRequest } from '@/lib/auth/request-security';
import { getDb } from '@/lib/db';
import { adminErrorResponse, adminJson } from '@/lib/domain/admin-route';
import {
  listManagedUsers,
  updateManagedUser,
  type AdministrationAdapter,
} from '@/lib/domain/administration';
import type { StaffActor } from '@/lib/domain/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z
  .object({
    reason: z.string().trim().min(5).max(1000),
    role: z.enum(['STUDENT', 'MODERATOR', 'ADMIN']).optional(),
    status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED']).optional(),
    userId: z.string().trim().min(1).max(191),
  })
  .strict()
  .refine(
    (value) =>
      Number(Boolean(value.role)) + Number(Boolean(value.status)) === 1,
  );

interface UserRouteDependencies {
  mutate?: (
    actor: StaffActor,
    input: z.infer<typeof schema>,
  ) => Promise<unknown>;
  resolveUser?: CurrentUserResolver;
}

export async function handleUserMutation(
  request: Request,
  dependencies: UserRouteDependencies = {},
) {
  if (!isSameOriginAuthRequest(request)) {
    return adminJson({ message: 'Invalid request origin.' }, { status: 403 });
  }
  try {
    const user = await requireRole(['ADMIN'], dependencies.resolveUser);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return adminJson(
        { message: 'Invalid user management request.' },
        { status: 400 },
      );
    }
    const actor = { campusId: user.campusId, id: user.id, role: user.role };
    const result = dependencies.mutate
      ? await dependencies.mutate(actor, parsed.data)
      : await updateManagedUser(
          getDb() as unknown as AdministrationAdapter,
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
    const user = await requireRole(['ADMIN']);
    const items = await listManagedUsers(
      getDb() as unknown as AdministrationAdapter,
      { campusId: user.campusId, id: user.id, role: user.role },
    );
    return adminJson({ items });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export function POST(request: Request) {
  return handleUserMutation(request);
}
