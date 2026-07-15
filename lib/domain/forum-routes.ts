import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  AuthenticationRequiredError,
  requireVerifiedUser,
  type CurrentUserResolver,
  VerificationRequiredError,
} from '@/lib/auth/guards';
import { isSameOriginAuthRequest } from '@/lib/auth/request-security';
import { getDb } from '@/lib/db';
import {
  createForumComment,
  createForumPost,
  deleteForumComment,
  deleteForumPost,
  type ForumActor,
  type ForumAdapter,
  ForumConflictError,
  ForumForbiddenError,
  ForumNotFoundError,
  ForumValidationError,
  ForumVerificationRequiredError,
  getForumPost,
  listForumComments,
  listForumPosts,
  toggleForumLike,
  updateForumComment,
  updateForumPost,
} from '@/lib/domain/forum';
import { loadAnonymousIdentityKeyring } from '@/lib/security/anonymous-identity';
import { JsonBodyError, readBoundedJson } from '@/lib/security/request-body';
import {
  createForumCommentSchema,
  createForumPostSchema,
  deleteForumCommentSchema,
  forumIdSchema,
  forumListQuerySchema,
  updateForumCommentSchema,
  updateForumPostSchema,
  type CreateForumPostInput,
  type ForumListQuery,
  type UpdateForumPostInput,
} from '@/lib/validation/forum';

type ForumView = 'discussion' | 'tree-hole';

export interface ForumRouteDependencies {
  create?: (actor: ForumActor, input: CreateForumPostInput) => Promise<unknown>;
  createComment?: (
    actor: ForumActor,
    input: { body: string; postId: string },
  ) => Promise<unknown>;
  detail?: (
    actor: ForumActor | null,
    input: { id: string; owner: boolean; view: ForumView },
  ) => Promise<unknown>;
  list?: (actor: ForumActor | null, query: ForumListQuery) => Promise<unknown>;
  listComments?: (
    actor: ForumActor | null,
    input: { page: number; pageSize: number; postId: string },
  ) => Promise<unknown>;
  remove?: (
    actor: ForumActor,
    input: { id: string; view: ForumView },
  ) => Promise<unknown>;
  removeComment?: (
    actor: ForumActor,
    input: { commentId: string; postId: string },
  ) => Promise<unknown>;
  resolveUser?: CurrentUserResolver;
  toggleLike?: (
    actor: ForumActor,
    input: { postId: string },
  ) => Promise<unknown>;
  update?: (
    actor: ForumActor,
    input: { changes: UpdateForumPostInput; id: string; view: ForumView },
  ) => Promise<unknown>;
  updateComment?: (
    actor: ForumActor,
    input: { body: string; commentId: string; postId: string },
  ) => Promise<unknown>;
}

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' };

function json(body: unknown, status: number) {
  return NextResponse.json(body, { headers: noStoreHeaders, status });
}

function actorFromSession(
  user: Awaited<ReturnType<typeof requireVerifiedUser>>,
) {
  return {
    campusId: user.campusId,
    emailVerifiedAt: user.emailVerifiedAt,
    id: user.id,
    role: user.role,
    status: user.status,
  } satisfies ForumActor;
}

function mapForumError(error: unknown) {
  if (error instanceof AuthenticationRequiredError) {
    return json({ message: '请先登录。' }, 401);
  }
  if (
    error instanceof VerificationRequiredError ||
    error instanceof ForumVerificationRequiredError
  ) {
    return json({ message: '需要已验证且状态正常的账号。' }, 403);
  }
  if (error instanceof ForumForbiddenError) {
    return json({ message: '无权执行此操作。' }, 403);
  }
  if (error instanceof ForumNotFoundError) {
    return json({ message: '未找到可访问的论坛内容。' }, 404);
  }
  if (error instanceof ForumConflictError) {
    return json({ message: '当前内容状态不允许此操作。' }, 409);
  }
  if (error instanceof ForumValidationError) {
    return json({ message: '论坛请求参数无效。' }, 400);
  }
  return json({ message: '论坛服务暂时不可用。' }, 500);
}

function strictSearchParams(request: Request) {
  const params = new URL(request.url).searchParams;
  for (const key of new Set(params.keys())) {
    if (params.getAll(key).length !== 1) throw new ForumValidationError();
  }
  return Object.fromEntries(params.entries());
}

const detailQuerySchema = z
  .object({
    owner: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .default(false),
    view: z.enum(['discussion', 'tree-hole']).default('discussion'),
  })
  .strict();

const commentsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

const emptyBodySchema = z.object({}).strict();

async function verifiedActor(resolveUser?: CurrentUserResolver) {
  return actorFromSession(await requireVerifiedUser(resolveUser));
}

async function runMutation<T>(
  request: Request,
  schema: z.ZodType<T>,
  resolveUser: CurrentUserResolver | undefined,
  action: (actor: ForumActor, body: T) => Promise<unknown>,
  successStatus = 200,
) {
  if (!isSameOriginAuthRequest(request)) {
    return json({ message: '请求来源无效。' }, 403);
  }
  try {
    const actor = await verifiedActor(resolveUser);
    const rawBody = await readBoundedJson(request).catch((error) => error);
    if (rawBody instanceof JsonBodyError) {
      return json({ message: '请求正文无效。' }, rawBody.status);
    }
    const parsed = schema.safeParse(rawBody);
    if (!parsed.success) return json({ message: '请求正文无效。' }, 400);
    return json(await action(actor, parsed.data), successStatus);
  } catch (error) {
    return mapForumError(error);
  }
}

function adapter() {
  return getDb() as unknown as ForumAdapter;
}

export async function handleForumPostCollectionGet(
  request: Request,
  dependencies: ForumRouteDependencies = {},
) {
  try {
    const parsed = forumListQuerySchema.safeParse(strictSearchParams(request));
    if (!parsed.success) throw new ForumValidationError();
    const actor =
      parsed.data.view === 'tree-hole'
        ? await verifiedActor(dependencies.resolveUser)
        : null;
    const result = dependencies.list
      ? await dependencies.list(actor, parsed.data)
      : await listForumPosts(adapter(), actor, parsed.data);
    return json(result, 200);
  } catch (error) {
    return mapForumError(error);
  }
}

export function handleForumPostCollectionPost(
  request: Request,
  dependencies: ForumRouteDependencies = {},
) {
  return runMutation(
    request,
    createForumPostSchema,
    dependencies.resolveUser,
    async (actor, input) => {
      if (dependencies.create) return dependencies.create(actor, input);
      return createForumPost(
        adapter(),
        actor,
        input,
        input.kind === 'TREE_HOLE' ? loadAnonymousIdentityKeyring() : undefined,
      );
    },
    201,
  );
}

export async function handleForumPostDetailGet(
  request: Request,
  id: string,
  dependencies: ForumRouteDependencies = {},
) {
  try {
    const validId = forumIdSchema.safeParse(id);
    const parsed = detailQuerySchema.safeParse(strictSearchParams(request));
    if (!validId.success || !parsed.success) throw new ForumValidationError();
    const actor =
      parsed.data.owner || parsed.data.view === 'tree-hole'
        ? await verifiedActor(dependencies.resolveUser)
        : null;
    const input = { id: validId.data, ...parsed.data };
    const result = dependencies.detail
      ? await dependencies.detail(actor, input)
      : await getForumPost(
          adapter(),
          actor,
          input,
          input.owner && input.view === 'tree-hole'
            ? loadAnonymousIdentityKeyring()
            : undefined,
        );
    return json(result, 200);
  } catch (error) {
    return mapForumError(error);
  }
}

function parseDetailView(request: Request) {
  const parsed = detailQuerySchema.safeParse(strictSearchParams(request));
  if (!parsed.success || parsed.data.owner) throw new ForumValidationError();
  return parsed.data.view;
}

export function handleForumPostDetailPatch(
  request: Request,
  id: string,
  dependencies: ForumRouteDependencies = {},
) {
  if (!isSameOriginAuthRequest(request)) {
    return Promise.resolve(json({ message: '请求来源无效。' }, 403));
  }
  let view: ForumView;
  try {
    if (!forumIdSchema.safeParse(id).success) throw new ForumValidationError();
    view = parseDetailView(request);
  } catch (error) {
    return Promise.resolve(mapForumError(error));
  }
  return runMutation(
    request,
    updateForumPostSchema,
    dependencies.resolveUser,
    async (actor, changes) => {
      const input = { changes, id, view };
      if (dependencies.update) return dependencies.update(actor, input);
      return updateForumPost(
        adapter(),
        actor,
        input,
        view === 'tree-hole' ? loadAnonymousIdentityKeyring() : undefined,
      );
    },
  );
}

export function handleForumPostDetailDelete(
  request: Request,
  id: string,
  dependencies: ForumRouteDependencies = {},
) {
  if (!isSameOriginAuthRequest(request)) {
    return Promise.resolve(json({ message: '请求来源无效。' }, 403));
  }
  let view: ForumView;
  try {
    if (!forumIdSchema.safeParse(id).success) throw new ForumValidationError();
    view = parseDetailView(request);
  } catch (error) {
    return Promise.resolve(mapForumError(error));
  }
  return runMutation(
    request,
    emptyBodySchema,
    dependencies.resolveUser,
    async (actor) => {
      const input = { id, view };
      if (dependencies.remove) return dependencies.remove(actor, input);
      return deleteForumPost(
        adapter(),
        actor,
        input,
        view === 'tree-hole' ? loadAnonymousIdentityKeyring() : undefined,
      );
    },
  );
}

export async function handleForumCommentsGet(
  request: Request,
  postId: string,
  dependencies: ForumRouteDependencies = {},
) {
  try {
    const validId = forumIdSchema.safeParse(postId);
    const parsed = commentsQuerySchema.safeParse(strictSearchParams(request));
    if (!validId.success || !parsed.success) throw new ForumValidationError();
    const input = { ...parsed.data, postId: validId.data };
    const result = dependencies.listComments
      ? await dependencies.listComments(null, input)
      : await listForumComments(adapter(), null, input);
    return json(result, 200);
  } catch (error) {
    return mapForumError(error);
  }
}

export function handleForumCommentsPost(
  request: Request,
  postId: string,
  dependencies: ForumRouteDependencies = {},
) {
  if (!isSameOriginAuthRequest(request)) {
    return Promise.resolve(json({ message: '请求来源无效。' }, 403));
  }
  const validId = forumIdSchema.safeParse(postId);
  if (!validId.success) {
    return Promise.resolve(json({ message: '论坛请求参数无效。' }, 400));
  }
  return runMutation(
    request,
    createForumCommentSchema,
    dependencies.resolveUser,
    async (actor, body) => {
      const input = { ...body, postId: validId.data };
      if (dependencies.createComment) {
        return dependencies.createComment(actor, input);
      }
      return createForumComment(adapter(), actor, input);
    },
    201,
  );
}

export function handleForumCommentsPatch(
  request: Request,
  postId: string,
  dependencies: ForumRouteDependencies = {},
) {
  if (!isSameOriginAuthRequest(request)) {
    return Promise.resolve(json({ message: '请求来源无效。' }, 403));
  }
  const validId = forumIdSchema.safeParse(postId);
  if (!validId.success) {
    return Promise.resolve(json({ message: '论坛请求参数无效。' }, 400));
  }
  return runMutation(
    request,
    updateForumCommentSchema,
    dependencies.resolveUser,
    async (actor, body) => {
      const input = { ...body, postId: validId.data };
      if (dependencies.updateComment) {
        return dependencies.updateComment(actor, input);
      }
      return updateForumComment(adapter(), actor, input);
    },
  );
}

export function handleForumCommentsDelete(
  request: Request,
  postId: string,
  dependencies: ForumRouteDependencies = {},
) {
  if (!isSameOriginAuthRequest(request)) {
    return Promise.resolve(json({ message: '请求来源无效。' }, 403));
  }
  const validId = forumIdSchema.safeParse(postId);
  if (!validId.success) {
    return Promise.resolve(json({ message: '论坛请求参数无效。' }, 400));
  }
  return runMutation(
    request,
    deleteForumCommentSchema,
    dependencies.resolveUser,
    async (actor, body) => {
      const input = { ...body, postId: validId.data };
      if (dependencies.removeComment) {
        return dependencies.removeComment(actor, input);
      }
      return deleteForumComment(adapter(), actor, input);
    },
  );
}

export function handleForumLikePost(
  request: Request,
  postId: string,
  dependencies: ForumRouteDependencies = {},
) {
  if (!isSameOriginAuthRequest(request)) {
    return Promise.resolve(json({ message: '请求来源无效。' }, 403));
  }
  const validId = forumIdSchema.safeParse(postId);
  if (!validId.success) {
    return Promise.resolve(json({ message: '论坛请求参数无效。' }, 400));
  }
  return runMutation(
    request,
    emptyBodySchema,
    dependencies.resolveUser,
    async (actor) => {
      const input = { postId: validId.data };
      if (dependencies.toggleLike) {
        return dependencies.toggleLike(actor, input);
      }
      return toggleForumLike(adapter(), actor, input);
    },
  );
}
