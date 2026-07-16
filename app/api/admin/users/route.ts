import { z } from 'zod';

import { requireRole, type CurrentUserResolver } from '@/lib/auth/guards';
import { isSameOriginAuthRequest } from '@/lib/auth/request-security';
import {
  getSessionCookieName,
  getSessionCookieOptions,
} from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { adminErrorResponse, adminJson } from '@/lib/domain/admin-route';
import { JsonBodyError, readBoundedJson } from '@/lib/security/request-body';
import {
  getManagedUserDetail,
  listManagedUsers,
  parseManagedUsersQuery,
  revokeManagedUserSessions,
  updateManagedUser,
  type AdministrationAdapter,
  type ManagedUserQuery,
} from '@/lib/domain/administration';
import type { StaffActor } from '@/lib/domain/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const roleSchema = z
  .object({
    action: z.literal('SET_ROLE'),
    reason: z.string().trim().min(5).max(1000),
    role: z.enum(['STUDENT', 'MODERATOR', 'ADMIN']),
    userId: z.string().trim().min(1).max(191),
  })
  .strict();
const statusSchema = z
  .object({
    action: z.literal('SET_STATUS'),
    reason: z.string().trim().min(5).max(1000),
    status: z.enum(['ACTIVE', 'SUSPENDED']),
    userId: z.string().trim().min(1).max(191),
  })
  .strict();
const revokeSchema = z
  .object({
    action: z.literal('REVOKE_SESSIONS'),
    reason: z.string().trim().min(5).max(1000),
    userId: z.string().trim().min(1).max(191),
  })
  .strict();
const schema = z.discriminatedUnion('action', [
  roleSchema,
  statusSchema,
  revokeSchema,
]);

type ManagedUserMutation =
  | { reason: string; role: 'STUDENT' | 'MODERATOR' | 'ADMIN'; userId: string }
  | {
      reason: string;
      status: 'ACTIVE' | 'SUSPENDED';
      userId: string;
    };

interface UserRouteDependencies {
  detail?: (actor: StaffActor, userId: string) => Promise<unknown>;
  list?: (actor: StaffActor, query: ManagedUserQuery) => Promise<unknown>;
  mutate?: (actor: StaffActor, input: ManagedUserMutation) => Promise<unknown>;
  resolveUser?: CurrentUserResolver;
  revoke?: (
    actor: StaffActor,
    input: { reason: string; userId: string },
  ) => Promise<unknown>;
}

function actorFrom(user: {
  campusId: string;
  id: string;
  role: 'STUDENT' | 'MODERATOR' | 'ADMIN';
}): StaffActor {
  return { campusId: user.campusId, id: user.id, role: user.role };
}

function mutationResultBody(result: unknown, selfRevoked: boolean) {
  if (result && !Array.isArray(result) && typeof result === 'object') {
    return { ...(result as Record<string, unknown>), selfRevoked };
  }
  return { result, selfRevoked };
}

function mutationRevokedSessions(result: unknown) {
  return (
    Boolean(result) &&
    typeof result === 'object' &&
    !Array.isArray(result) &&
    (result as Record<string, unknown>).sessionsRevoked === true
  );
}

export async function handleUserGet(
  request: Request,
  dependencies: UserRouteDependencies = {},
) {
  try {
    const user = await requireRole(['ADMIN'], dependencies.resolveUser);
    const actor = actorFrom(user);
    const parsed = parseManagedUsersQuery(new URL(request.url).searchParams);
    if (parsed.userId) {
      const detail = dependencies.detail
        ? await dependencies.detail(actor, parsed.userId)
        : await getManagedUserDetail(
            getDb() as unknown as AdministrationAdapter,
            actor,
            parsed.userId,
          );
      return adminJson({ detail, tab: parsed.tab });
    }
    const result = dependencies.list
      ? await dependencies.list(actor, parsed.query)
      : await listManagedUsers(
          getDb() as unknown as AdministrationAdapter,
          actor,
          parsed.query,
        );
    return adminJson(result);
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function handleUserMutation(
  request: Request,
  dependencies: UserRouteDependencies = {},
) {
  if (!isSameOriginAuthRequest(request)) {
    return adminJson({ message: '请求来源无效。' }, { status: 403 });
  }
  try {
    const user = await requireRole(['ADMIN'], dependencies.resolveUser);
    const body = await readBoundedJson(request).catch((error) => error);
    if (body instanceof JsonBodyError) {
      return adminJson(
        { message: '用户管理请求无效。' },
        { status: body.status },
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return adminJson({ message: '用户管理请求无效。' }, { status: 400 });
    }
    const actor = actorFrom(user);
    let result: unknown;
    let sessionsRevoked = false;
    if (parsed.data.action === 'REVOKE_SESSIONS') {
      const input = {
        reason: parsed.data.reason,
        userId: parsed.data.userId,
      };
      result = dependencies.revoke
        ? await dependencies.revoke(actor, input)
        : await revokeManagedUserSessions(
            getDb() as unknown as AdministrationAdapter,
            actor,
            input,
          );
      sessionsRevoked = true;
    } else if (parsed.data.action === 'SET_ROLE') {
      const input = {
        reason: parsed.data.reason,
        role: parsed.data.role,
        userId: parsed.data.userId,
      };
      result = dependencies.mutate
        ? await dependencies.mutate(actor, input)
        : await updateManagedUser(
            getDb() as unknown as AdministrationAdapter,
            actor,
            input,
          );
      sessionsRevoked = mutationRevokedSessions(result);
    } else {
      const input = {
        reason: parsed.data.reason,
        status: parsed.data.status,
        userId: parsed.data.userId,
      };
      result = dependencies.mutate
        ? await dependencies.mutate(actor, input)
        : await updateManagedUser(
            getDb() as unknown as AdministrationAdapter,
            actor,
            input,
          );
      sessionsRevoked = mutationRevokedSessions(result);
    }
    const selfRevoked =
      parsed.data.userId === actor.id && sessionsRevoked === true;
    const response = adminJson(mutationResultBody(result, selfRevoked));
    if (selfRevoked) {
      response.cookies.set({
        ...getSessionCookieOptions(),
        maxAge: 0,
        name: getSessionCookieName(),
        value: '',
      });
    }
    return response;
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export function GET(request: Request) {
  return handleUserGet(request);
}

export function POST(request: Request) {
  return handleUserMutation(request);
}
