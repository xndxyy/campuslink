import { z } from 'zod';
import { requireRole, type CurrentUserResolver } from '@/lib/auth/guards';
import { isSameOriginAuthRequest } from '@/lib/auth/request-security';
import { getDb } from '@/lib/db';
import { adminErrorResponse, adminJson } from '@/lib/domain/admin-route';
import {
  testAiConnection,
  type AiSettingsActor,
  type AiSettingsAdapter,
} from '@/lib/domain/ai-settings';
import { loadAiEncryptionKey } from '@/lib/security/encrypted-secret';
import { loadOutboundAiPolicy } from '@/lib/security/outbound-url';
import { JsonBodyError, readBoundedJson } from '@/lib/security/request-body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Dependencies = {
  resolveUser?: CurrentUserResolver;
  testConnection?: (actor: AiSettingsActor) => Promise<unknown>;
};
const empty = z.object({}).strict();
export async function handleAiSettingsTestPost(
  request: Request,
  dependencies: Dependencies = {},
) {
  if (!isSameOriginAuthRequest(request))
    return adminJson({ message: '请求来源无效。' }, { status: 403 });
  try {
    const user = await requireRole(['ADMIN'], dependencies.resolveUser);
    const body = await readBoundedJson(request).catch((error) => error);
    if (body instanceof JsonBodyError || !empty.safeParse(body).success)
      return adminJson(
        { message: 'AI 连接测试请求无效。' },
        { status: body instanceof JsonBodyError ? body.status : 400 },
      );
    const actor = { campusId: user.campusId, id: user.id, role: user.role };
    if (dependencies.testConnection)
      return adminJson(await dependencies.testConnection(actor));
    const encryption = loadAiEncryptionKey();
    return adminJson(
      await testAiConnection(getDb() as unknown as AiSettingsAdapter, actor, {
        encryptionKeys: encryption.keys,
        policy: loadOutboundAiPolicy(),
      }),
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}
export function POST(request: Request) {
  return handleAiSettingsTestPost(request);
}
