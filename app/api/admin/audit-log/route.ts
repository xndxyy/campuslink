import { requireRole } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import { adminErrorResponse, adminJson } from '@/lib/domain/admin-route';
import {
  listAuditLogs,
  parseAuditQuery,
  type AuditAdapter,
} from '@/lib/domain/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await requireRole(['ADMIN']);
    const query = parseAuditQuery(new URL(request.url).searchParams);
    const result = await listAuditLogs(
      getDb() as unknown as AuditAdapter,
      { campusId: user.campusId, id: user.id, role: user.role },
      query,
    );
    return adminJson(result);
  } catch (error) {
    return adminErrorResponse(error);
  }
}
