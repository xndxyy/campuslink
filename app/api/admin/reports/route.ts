import { z } from 'zod';

import { requireRole } from '@/lib/auth/guards';
import { isSameOriginAuthRequest } from '@/lib/auth/request-security';
import { getDb } from '@/lib/db';
import { adminErrorResponse, adminJson } from '@/lib/domain/admin-route';
import {
  dismissReport,
  listModerationReports,
  resolveReport,
  triageReport,
  type ModerationAdapter,
} from '@/lib/domain/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z
  .object({
    action: z.enum(['TRIAGE', 'DISMISS', 'RESOLVE']),
    hideTarget: z.boolean().optional(),
    reason: z.string().trim().min(5).max(1000),
    reportId: z.string().trim().min(1).max(191),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.hideTarget !== undefined && value.action !== 'RESOLVE') {
      context.addIssue({
        code: 'custom',
        message: 'Only resolution may hide a target',
      });
    }
  });

export async function GET() {
  try {
    const user = await requireRole(['MODERATOR', 'ADMIN']);
    const items = await listModerationReports(
      getDb() as unknown as ModerationAdapter,
      { campusId: user.campusId, id: user.id, role: user.role },
    );
    return adminJson({ items });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) {
    return adminJson({ message: 'Invalid request origin.' }, { status: 403 });
  }
  try {
    const user = await requireRole(['MODERATOR', 'ADMIN']);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return adminJson({ message: 'Invalid report action.' }, { status: 400 });
    }
    const adapter = getDb() as unknown as ModerationAdapter;
    const actor = { campusId: user.campusId, id: user.id, role: user.role };
    const result =
      parsed.data.action === 'TRIAGE'
        ? await triageReport(adapter, actor, parsed.data)
        : parsed.data.action === 'DISMISS'
          ? await dismissReport(adapter, actor, parsed.data)
          : await resolveReport(adapter, actor, {
              hideTarget: parsed.data.hideTarget ?? false,
              reason: parsed.data.reason,
              reportId: parsed.data.reportId,
            });
    return adminJson(result);
  } catch (error) {
    return adminErrorResponse(error);
  }
}
