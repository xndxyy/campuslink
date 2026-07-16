import { NextResponse } from 'next/server';

import { verifyEmailToken } from '@/lib/auth/auth-service';
import { verificationCompletionSchema } from '@/lib/auth/credentials';
import { createEnvironmentRateLimiter } from '@/lib/auth/rate-limit';
import {
  getApplicationRedirectUrl,
  getClientRateLimitKey,
  isSameOriginAuthRequest,
} from '@/lib/auth/request-security';
import { JsonBodyError, readBoundedJson } from '@/lib/security/request-body';

export const runtime = 'nodejs';

const rateLimiter = createEnvironmentRateLimiter();

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

export async function POST(request: Request) {
  const json = wantsJson(request);
  if (!isSameOriginAuthRequest(request)) {
    return json
      ? NextResponse.json(
          { message: '请求来源无效。' },
          { status: 403 },
        )
      : NextResponse.redirect(
          getApplicationRedirectUrl('/auth/verify?error=origin'),
          303,
        );
  }

  const rateLimit = await rateLimiter.consume(getClientRateLimitKey(request));
  if (!rateLimit.allowed) {
    const response = json
      ? NextResponse.json(
          { message: '操作过于频繁，请稍后再试。' },
          { status: 429 },
        )
      : NextResponse.redirect(
          getApplicationRedirectUrl('/auth/verify?error=rate-limit'),
          303,
        );
    response.headers.set('Retry-After', String(rateLimit.retryAfterSeconds));
    return response;
  }

  const body = await getBody(request);
  if (body instanceof JsonBodyError) {
    return NextResponse.json(
      { message: '验证链接无效或已过期。' },
      { status: body.status },
    );
  }
  const parsed = verificationCompletionSchema.safeParse(body);
  if (!parsed.success) {
    return json
      ? NextResponse.json(
          { message: '验证链接无效或已过期。' },
          { status: 400 },
        )
      : NextResponse.redirect(
          getApplicationRedirectUrl('/auth/verify?error=invalid'),
          303,
        );
  }

  const verified = await verifyEmailToken(
    parsed.data.token,
    parsed.data.password,
  );
  if (!verified) {
    return json
      ? NextResponse.json(
          { message: '验证链接无效或已过期。' },
          { status: 400 },
        )
      : NextResponse.redirect(
          getApplicationRedirectUrl('/auth/verify?error=invalid'),
          303,
        );
  }

  return json
    ? NextResponse.json({ message: '邮箱验证成功。' })
    : NextResponse.redirect(
        getApplicationRedirectUrl('/auth/sign-in?verified=1'),
        303,
      );
}
