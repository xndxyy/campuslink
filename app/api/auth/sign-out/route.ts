import { NextResponse } from 'next/server';

import { revokeCurrentSession } from '@/lib/auth/auth-service';
import { createEnvironmentRateLimiter } from '@/lib/auth/rate-limit';
import {
  getApplicationRedirectUrl,
  getClientRateLimitKey,
  isSameOriginAuthRequest,
} from '@/lib/auth/request-security';
import {
  getSessionCookieName,
  getSessionCookieOptions,
} from '@/lib/auth/session';

export const runtime = 'nodejs';

const rateLimiter = createEnvironmentRateLimiter();

export async function POST(request: Request) {
  const json =
    request.headers.get('content-type')?.includes('application/json') ?? false;
  if (!isSameOriginAuthRequest(request)) {
    return json
      ? NextResponse.json({ message: '请求来源无效。' }, { status: 403 })
      : NextResponse.redirect(getApplicationRedirectUrl('/?error=origin'), 303);
  }

  const rateLimit = await rateLimiter.consume(getClientRateLimitKey(request));
  if (!rateLimit.allowed) {
    const response = json
      ? NextResponse.json(
          { message: '操作过于频繁，请稍后再试。' },
          { status: 429 },
        )
      : NextResponse.redirect(
          getApplicationRedirectUrl('/?error=rate-limit'),
          303,
        );
    response.headers.set('Retry-After', String(rateLimit.retryAfterSeconds));
    return response;
  }

  await revokeCurrentSession();

  const response = json
    ? new NextResponse(null, { status: 204 })
    : NextResponse.redirect(getApplicationRedirectUrl('/'), 303);
  response.cookies.set({
    ...getSessionCookieOptions(),
    maxAge: 0,
    name: getSessionCookieName(),
    value: '',
  });
  return response;
}
