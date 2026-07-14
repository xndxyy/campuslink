import { z } from 'zod';

import { requireRole, type CurrentUserResolver } from '@/lib/auth/guards';
import { isSameOriginAuthRequest } from '@/lib/auth/request-security';
import { getDb } from '@/lib/db';
import { adminErrorResponse, adminJson } from '@/lib/domain/admin-route';
import {
  createPresetTag,
  listManagedTags,
  parseManagedTagQuery,
  promoteCustomTag,
  setTagActive,
  type ManagedTagPage,
  type ManagedTagQuery,
  type TagActor,
  type TagAdapter,
} from '@/lib/domain/tags';
import { JsonBodyError, readBoundedJson } from '@/lib/security/request-body';
import { normalizeTagLabel, type TagScope } from '@/lib/validation/tags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const scopeSchema = z.enum(['RESOURCE', 'MARKETPLACE', 'CAMPUS_WORK']);
const reasonSchema = z.string().trim().min(5).max(1000);
const idSchema = z.string().trim().min(1).max(191);
const labelSchema = z
  .string()
  .max(128)
  .transform((value, context) => {
    try {
      return normalizeTagLabel(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Invalid tag label' });
      return z.NEVER;
    }
  });
const createSchema = z
  .object({
    action: z.literal('CREATE_PRESET'),
    label: labelSchema,
    reason: reasonSchema,
    scope: scopeSchema,
  })
  .strict();
const activeSchema = z
  .object({
    action: z.literal('SET_ACTIVE'),
    active: z.boolean(),
    reason: reasonSchema,
    scope: scopeSchema,
    tagId: idSchema,
  })
  .strict();
const promoteSchema = z
  .object({
    action: z.literal('PROMOTE_CUSTOM'),
    reason: reasonSchema,
    scope: scopeSchema,
    tagId: idSchema,
  })
  .strict();
const mutationSchema = z.discriminatedUnion('action', [
  createSchema,
  activeSchema,
  promoteSchema,
]);

type CreateInput = Omit<z.infer<typeof createSchema>, 'action'>;
type ActiveInput = Omit<z.infer<typeof activeSchema>, 'action'>;
type PromoteInput = Omit<z.infer<typeof promoteSchema>, 'action'>;

interface TagRouteDependencies {
  create?: (actor: TagActor, input: CreateInput) => Promise<unknown>;
  list?: (
    actor: TagActor,
    scope: TagScope,
    query: ManagedTagQuery,
  ) => Promise<ManagedTagPage>;
  promote?: (actor: TagActor, input: PromoteInput) => Promise<unknown>;
  resolveUser?: CurrentUserResolver;
  setActive?: (actor: TagActor, input: ActiveInput) => Promise<unknown>;
}

function actorFrom(user: {
  campusId: string;
  id: string;
  role: 'STUDENT' | 'MODERATOR' | 'ADMIN';
}): TagActor {
  return { campusId: user.campusId, id: user.id, role: user.role };
}

export async function handleTagGet(
  request: Request,
  dependencies: TagRouteDependencies = {},
) {
  try {
    const user = await requireRole(['ADMIN'], dependencies.resolveUser);
    const actor = actorFrom(user);
    const { query, scope } = parseManagedTagQuery(
      new URL(request.url).searchParams,
    );
    const result = dependencies.list
      ? await dependencies.list(actor, scope, query)
      : await listManagedTags(
          getDb() as unknown as TagAdapter,
          actor,
          scope,
          query,
        );
    return adminJson({ ...result, scope });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function handleTagPost(
  request: Request,
  dependencies: TagRouteDependencies = {},
) {
  if (!isSameOriginAuthRequest(request)) {
    return adminJson({ message: 'Invalid request origin.' }, { status: 403 });
  }
  try {
    const user = await requireRole(['ADMIN'], dependencies.resolveUser);
    const actor = actorFrom(user);
    const body = await readBoundedJson(request).catch((error) => error);
    if (body instanceof JsonBodyError) {
      return adminJson(
        { message: 'Invalid tag administration request.' },
        { status: body.status },
      );
    }
    const parsed = mutationSchema.safeParse(body);
    if (!parsed.success) {
      return adminJson(
        { message: 'Invalid tag administration request.' },
        { status: 400 },
      );
    }
    const { action, ...input } = parsed.data;
    let result: unknown;
    if (action === 'CREATE_PRESET') {
      result = dependencies.create
        ? await dependencies.create(actor, input as CreateInput)
        : await createPresetTag(
            getDb() as unknown as TagAdapter,
            actor,
            input as CreateInput,
          );
    } else if (action === 'SET_ACTIVE') {
      result = dependencies.setActive
        ? await dependencies.setActive(actor, input as ActiveInput)
        : await setTagActive(
            getDb() as unknown as TagAdapter,
            actor,
            input as ActiveInput,
          );
    } else {
      result = dependencies.promote
        ? await dependencies.promote(actor, input as PromoteInput)
        : await promoteCustomTag(
            getDb() as unknown as TagAdapter,
            actor,
            input as PromoteInput,
          );
    }
    return adminJson(result);
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export function GET(request: Request) {
  return handleTagGet(request);
}

export function POST(request: Request) {
  return handleTagPost(request);
}
