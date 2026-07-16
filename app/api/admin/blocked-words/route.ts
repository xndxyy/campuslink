import { z } from 'zod';

import { requireRole, type CurrentUserResolver } from '@/lib/auth/guards';
import { isSameOriginAuthRequest } from '@/lib/auth/request-security';
import { getDb } from '@/lib/db';
import { adminErrorResponse, adminJson } from '@/lib/domain/admin-route';
import {
  createBlockedWord,
  deleteBlockedWord,
  listBlockedWords,
  setBlockedWordEnabled,
  type BlockedWordActor,
  type BlockedWordAdapter,
} from '@/lib/domain/blocked-words';
import { JsonBodyError, readBoundedJson } from '@/lib/security/request-body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const reason = z.string().trim().min(5).max(1000);
const wordId = z.string().trim().min(1).max(191);
const mutation = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('CREATE'),
      category: z.string().trim().min(1).max(100),
      original: z.string().max(200),
      reason,
    })
    .strict(),
  z
    .object({
      action: z.literal('SET_ENABLED'),
      enabled: z.boolean(),
      id: wordId,
      reason,
    })
    .strict(),
  z.object({ action: z.literal('DELETE'), id: wordId, reason }).strict(),
]);

type Dependencies = {
  create?: (
    actor: BlockedWordActor,
    input: { category: string; original: string; reason: string },
  ) => Promise<unknown>;
  delete?: (
    actor: BlockedWordActor,
    input: { id: string; reason: string },
  ) => Promise<unknown>;
  resolveUser?: CurrentUserResolver;
  setEnabled?: (
    actor: BlockedWordActor,
    input: { enabled: boolean; id: string; reason: string },
  ) => Promise<unknown>;
};

function actor(user: {
  campusId: string;
  id: string;
  role: 'STUDENT' | 'MODERATOR' | 'ADMIN';
}): BlockedWordActor {
  return { campusId: user.campusId, id: user.id, role: user.role };
}

export async function handleBlockedWordGet(
  request: Request,
  dependencies: Dependencies = {},
) {
  try {
    const user = await requireRole(['ADMIN'], dependencies.resolveUser);
    const result = await listBlockedWords(
      getDb() as unknown as BlockedWordAdapter,
      actor(user),
    );
    return adminJson({ items: result });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function handleBlockedWordPost(
  request: Request,
  dependencies: Dependencies = {},
) {
  if (!isSameOriginAuthRequest(request))
    return adminJson({ message: '请求来源无效。' }, { status: 403 });
  try {
    const user = await requireRole(['ADMIN'], dependencies.resolveUser);
    const body = await readBoundedJson(request).catch((error) => error);
    if (body instanceof JsonBodyError)
      return adminJson(
        { message: '屏蔽词管理请求无效。' },
        { status: body.status },
      );
    const parsed = mutation.safeParse(body);
    if (!parsed.success)
      return adminJson(
        { message: '屏蔽词管理请求无效。' },
        { status: 400 },
      );
    if (parsed.data.action === 'CREATE')
      return adminJson(
        dependencies.create
          ? await dependencies.create(actor(user), parsed.data)
          : await createBlockedWord(
              getDb() as unknown as BlockedWordAdapter,
              actor(user),
              parsed.data,
            ),
      );
    if (parsed.data.action === 'SET_ENABLED') {
      if (dependencies.setEnabled)
        await dependencies.setEnabled(actor(user), parsed.data);
      else
        await setBlockedWordEnabled(
          getDb() as unknown as BlockedWordAdapter,
          actor(user),
          parsed.data,
        );
      return adminJson({ ok: true });
    }
    if (dependencies.delete)
      await dependencies.delete(actor(user), parsed.data);
    else
      await deleteBlockedWord(
        getDb() as unknown as BlockedWordAdapter,
        actor(user),
        parsed.data,
      );
    return adminJson({ ok: true });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export function GET(request: Request) {
  return handleBlockedWordGet(request);
}
export function POST(request: Request) {
  return handleBlockedWordPost(request);
}
