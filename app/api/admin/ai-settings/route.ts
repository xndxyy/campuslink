import { z } from 'zod';
import { requireRole, type CurrentUserResolver } from '@/lib/auth/guards';
import { isSameOriginAuthRequest } from '@/lib/auth/request-security';
import { getDb } from '@/lib/db';
import { adminErrorResponse, adminJson } from '@/lib/domain/admin-route';
import {
  getAiSettings,
  saveAiSettings,
  type AiSettingsActor,
  type AiSettingsAdapter,
} from '@/lib/domain/ai-settings';
import { loadAiEncryptionKey } from '@/lib/security/encrypted-secret';
import {
  loadOutboundAiPolicy,
  validateOutboundAiUrl,
} from '@/lib/security/outbound-url';
import { JsonBodyError, readBoundedJson } from '@/lib/security/request-body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const schema = z
  .object({
    apiKey: z.string().max(4096).optional(),
    baseUrl: z.string().trim().min(1).max(500),
    blockThreshold: z.number().int().min(1).max(100),
    enabled: z.boolean(),
    model: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(5).max(1000),
    reviewThreshold: z.number().int().min(0).max(99),
    timeoutMs: z.number().int().min(1000).max(60000),
  })
  .strict();
type Input = z.infer<typeof schema>;
type Dependencies = {
  get?: (actor: AiSettingsActor) => Promise<unknown>;
  resolveUser?: CurrentUserResolver;
  save?: (actor: AiSettingsActor, input: Input) => Promise<unknown>;
};
function actor(user: {
  campusId: string;
  id: string;
  role: 'STUDENT' | 'MODERATOR' | 'ADMIN';
}): AiSettingsActor {
  return { campusId: user.campusId, id: user.id, role: user.role };
}

export async function handleAiSettingsGet(
  _request: Request,
  dependencies: Dependencies = {},
) {
  try {
    const user = await requireRole(['ADMIN'], dependencies.resolveUser);
    const result = dependencies.get
      ? await dependencies.get(actor(user))
      : await getAiSettings(
          getDb() as unknown as AiSettingsAdapter,
          actor(user),
        );
    return adminJson(result);
  } catch (error) {
    return adminErrorResponse(error);
  }
}
export async function handleAiSettingsPost(
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
        { message: 'AI 设置请求无效。' },
        { status: body.status },
      );
    const parsed = schema.safeParse(body);
    if (
      !parsed.success ||
      parsed.data.reviewThreshold >= parsed.data.blockThreshold
    )
      return adminJson(
        { message: 'AI 设置请求无效。' },
        { status: 400 },
      );
    if (dependencies.save)
      return adminJson(await dependencies.save(actor(user), parsed.data));
    const encryption = loadAiEncryptionKey();
    const policy = loadOutboundAiPolicy();
    return adminJson(
      await saveAiSettings(
        getDb() as unknown as AiSettingsAdapter,
        actor(user),
        parsed.data,
        {
          encryptionKey: encryption.keys.get(encryption.currentVersion)!,
          validateUrl: (value) => validateOutboundAiUrl(value, policy),
        },
      ),
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}
export function GET(request: Request) {
  return handleAiSettingsGet(request);
}
export function POST(request: Request) {
  return handleAiSettingsPost(request);
}
