import { z } from 'zod';

import { requireRole } from '@/lib/auth/guards';
import { isSameOriginAuthRequest } from '@/lib/auth/request-security';
import { getDb } from '@/lib/db';
import { adminErrorResponse, adminJson } from '@/lib/domain/admin-route';
import { JsonBodyError, readBoundedJson } from '@/lib/security/request-body';
import {
  updateCampusConfig,
  type AdministrationAdapter,
} from '@/lib/domain/administration';

export const runtime = 'nodejs';

const schema = z
  .object({
    name: z.string().trim().min(2).max(200),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) {
    return adminJson({ message: '请求来源无效。' }, { status: 403 });
  }
  try {
    const user = await requireRole(['ADMIN']);
    const body = await readBoundedJson(request).catch((error) => error);
    if (body instanceof JsonBodyError) {
      return adminJson(
        { message: '校区设置无效。' },
        { status: body.status },
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return adminJson(
        { message: '校区设置无效。' },
        { status: 400 },
      );
    }
    const result = await updateCampusConfig(
      getDb() as unknown as AdministrationAdapter,
      { campusId: user.campusId, id: user.id, role: user.role },
      parsed.data,
    );
    return adminJson(result);
  } catch (error) {
    return adminErrorResponse(error);
  }
}
