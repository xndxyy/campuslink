import { NextResponse } from 'next/server';

import { revokeCurrentSession } from '@/lib/auth/auth-service';
import {
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/session';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  await revokeCurrentSession();

  const response = request.headers
    .get('content-type')
    ?.includes('application/json')
    ? new NextResponse(null, { status: 204 })
    : NextResponse.redirect(new URL('/', request.url), 303);
  response.cookies.set({
    ...getSessionCookieOptions(),
    maxAge: 0,
    name: SESSION_COOKIE_NAME,
    value: '',
  });
  return response;
}
