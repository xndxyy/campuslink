import { NextResponse } from 'next/server';

import { signInWithPassword } from '@/lib/auth/auth-service';
import { signInSchema } from '@/lib/auth/credentials';
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
import { JsonBodyError, readBoundedJson } from '@/lib/security/request-body';

export const runtime = 'nodejs';

const rateLimiter = createEnvironmentRateLimiter();
const genericFailure = { message: '邮箱或密码错误。' };

function wantsJson(request: Request): boolean {
  return (
    request.headers.get('content-type')?.includes('application/json') ?? false
  );
}

async function getBody(request: Request): Promise<unknown> {
  return wantsJson(request)
    ? readBoundedJson(request).catch((error) => error)
    : Object.fromEntries(await request.formData());
}

function rateLimited(
  request: Request,
  json: boolean,
  retryAfterSeconds: number,
): NextResponse {
  const response = json
    ? NextResponse.json(
        { message: '操作过于频繁，请稍后再试。' },
        { status: 429 },
      )
    : NextResponse.redirect(
        getApplicationRedirectUrl('/auth/sign-in?error=rate-limit'),
        303,
      );
  response.headers.set('Retry-After', String(retryAfterSeconds));
  return response;
}

export async function POST(request: Request) {
  const json = wantsJson(request);
  if (!isSameOriginAuthRequest(request)) {
    return json
      ? NextResponse.json({ message: '请求来源无效。' }, { status: 403 })
      : NextResponse.redirect(
          getApplicationRedirectUrl('/auth/sign-in?error=origin'),
          303,
        );
  }

  const clientLimit = await rateLimiter.consume(getClientRateLimitKey(request));
  if (!clientLimit.allowed) {
    return rateLimited(request, json, clientLimit.retryAfterSeconds);
  }

  const body = await getBody(request);
  if (body instanceof JsonBodyError) {
    return NextResponse.json(genericFailure, { status: body.status });
  }
  const parsed = signInSchema.safeParse(body);
  if (!parsed.success) {
    return json
      ? NextResponse.json(genericFailure, { status: 401 })
      : NextResponse.redirect(
          getApplicationRedirectUrl('/auth/sign-in?error=invalid'),
          303,
        );
  }

  const emailLimit = await rateLimiter.consume(`email:${parsed.data.email}`);
  if (!emailLimit.allowed) {
    return rateLimited(request, json, emailLimit.retryAfterSeconds);
  }

  const session = await signInWithPassword(parsed.data);
  if (!session) {
    return json
      ? NextResponse.json(genericFailure, { status: 401 })
      : NextResponse.redirect(
          getApplicationRedirectUrl('/auth/sign-in?error=invalid'),
          303,
        );
  }

  const response = json
    ? NextResponse.json({ message: '登录成功。' })
    : NextResponse.redirect(getApplicationRedirectUrl('/'), 303);
  response.cookies.set({
    ...getSessionCookieOptions(),
    expires: session.expires,
    name: getSessionCookieName(),
    value: session.token,
  });
  return response;
}
