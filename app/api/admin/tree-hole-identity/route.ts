import { z } from 'zod';

import { requireRole, type CurrentUserResolver } from '@/lib/auth/guards';
import { isSameOriginAuthRequest } from '@/lib/auth/request-security';
import { getDb } from '@/lib/db';
import { adminErrorResponse, adminJson } from '@/lib/domain/admin-route';
import {
  revealTreeHoleAuthor,
  type TreeHoleIdentityActor,
  type TreeHoleIdentityAdapter,
  type TreeHoleIdentityInput,
} from '@/lib/domain/tree-hole-identity';
import { loadAnonymousIdentityKeyring } from '@/lib/security/anonymous-identity';
import { JsonBodyError, readBoundedJson } from '@/lib/security/request-body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.string().trim().min(1).max(191);
const revealSchema = z
  .object({
    postId: idSchema,
    reason: z.string().trim().min(5).max(1000),
    reportId: idSchema,
  })
  .strict();

interface TreeHoleIdentityRouteDependencies {
  resolveUser?: CurrentUserResolver;
  reveal?: (
    actor: TreeHoleIdentityActor,
    input: TreeHoleIdentityInput,
  ) => Promise<{ userId: string }>;
}

export async function handleTreeHoleIdentityPost(
  request: Request,
  dependencies: TreeHoleIdentityRouteDependencies = {},
) {
  if (!isSameOriginAuthRequest(request)) {
    return adminJson({ message: '请求来源无效。' }, { status: 403 });
  }

  try {
    const user = await requireRole(['ADMIN'], dependencies.resolveUser);
    const body = await readBoundedJson(request).catch((error) => error);
    if (body instanceof JsonBodyError) {
      return adminJson(
        { message: '树洞身份核验请求无效。' },
        { status: body.status },
      );
    }
    const parsed = revealSchema.safeParse(body);
    if (!parsed.success) {
      return adminJson({ message: '树洞身份核验请求无效。' }, { status: 400 });
    }
    const actor: TreeHoleIdentityActor = {
      campusId: user.campusId,
      id: user.id,
      role: user.role,
    };
    const result = dependencies.reveal
      ? await dependencies.reveal(actor, parsed.data)
      : await revealTreeHoleAuthor(
          getDb() as unknown as TreeHoleIdentityAdapter,
          actor,
          parsed.data,
          loadAnonymousIdentityKeyring(),
        );
    return adminJson({ userId: result.userId });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export function POST(request: Request) {
  return handleTreeHoleIdentityPost(request);
}
