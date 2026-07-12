import { handleReportPost } from '@/lib/domain/engagement-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  return handleReportPost(request);
}
