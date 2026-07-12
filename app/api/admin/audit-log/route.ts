import { requireRole } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import { adminErrorResponse, adminJson } from '@/lib/domain/admin-route';
import { listAuditLogs, type AuditAdapter } from '@/lib/domain/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await requireRole(['ADMIN']);
    const url = new URL(request.url);
    const result = await listAuditLogs(
      getDb() as unknown as AuditAdapter,
      { campusId: user.campusId, id: user.id, role: user.role },
      {
        action: url.searchParams.get('action') || undefined,
        actorId: url.searchParams.get('actorId') || undefined,
        from: url.searchParams.get('from')
          ? new Date(url.searchParams.get('from')!)
          : undefined,
        subjectId: url.searchParams.get('subjectId') || undefined,
        subjectType: url.searchParams.get('subjectType') || undefined,
        to: url.searchParams.get('to')
          ? new Date(url.searchParams.get('to')!)
          : undefined,
      },
    );
    return adminJson(result);
  } catch (error) {
    return adminErrorResponse(error);
  }
}
