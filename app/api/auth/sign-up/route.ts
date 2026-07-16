import { NextResponse } from 'next/server';

import { signUpWithPassword } from '@/lib/auth/auth-service';
import { signUpSchema } from '@/lib/auth/credentials';
import { createEnvironmentRateLimiter } from '@/lib/auth/rate-limit';
import {
  getApplicationRedirectUrl,
  getClientRateLimitKey,
  isSameOriginAuthRequest,
} from '@/lib/auth/request-security';
import { JsonBodyError, readBoundedJson } from '@/lib/security/request-body';

export const runtime = 'nodejs';

const rateLimiter = createEnvironmentRateLimiter({ limit: 5 });

function wantsJson(request: Request): boolean {
  return (
    request.headers.get('content-type')?.includes('application/json') ?? false
  );
}

function originFailure(request: Request, json: boolean): NextResponse {
  return json
    ? NextResponse.json({ message: '请求来源无效。' }, { status: 403 })
    : NextResponse.redirect(
        getApplicationRedirectUrl('/auth/sign-up?error=origin'),
        303,
      );
}

function rateLimited(
  request: Request,
  json: boolean,
  retryAfterSeconds: number,
): NextResponse {
  const response = json
    ? NextResponse.json({ message: '操作过于频繁，请稍后再试。' }, { status: 429 })
    : NextResponse.redirect(
        getApplicationRedirectUrl('/auth/sign-up?error=rate-limit'),
        303,
      );
  response.headers.set('Retry-After', String(retryAfterSeconds));
  return response;
}

async function getBody(request: Request): Promise<unknown> {
  return wantsJson(request)
    ? readBoundedJson(request).catch((error) => error)
    : Object.fromEntries(await request.formData());
}

export async function POST(request: Request) {
  const json = wantsJson(request);
  if (!isSameOriginAuthRequest(request)) {
    return originFailure(request, json);
  }

  const clientLimit = await rateLimiter.consume(getClientRateLimitKey(request));
  if (!clientLimit.allowed) {
    return rateLimited(request, json, clientLimit.retryAfterSeconds);
  }

  const body = await getBody(request);
  if (body instanceof JsonBodyError) {
    return NextResponse.json(
      { message: '注册信息无效。' },
      { status: body.status },
    );
  }
  const parsed = signUpSchema.safeParse(body);
  if (!parsed.success) {
    return json
      ? NextResponse.json(
          { message: '注册信息无效。' },
          { status: 400 },
        )
      : NextResponse.redirect(
          getApplicationRedirectUrl('/auth/sign-up?error=invalid'),
          303,
        );
  }

  const emailLimit = await rateLimiter.consume(`email:${parsed.data.email}`);
  if (!emailLimit.allowed) {
    return rateLimited(request, json, emailLimit.retryAfterSeconds);
  }

  try {
    await signUpWithPassword(parsed.data);
  } catch (error) {
    console.error('Registration verification delivery failed.', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return json
      ? NextResponse.json(
          { message: '暂时无法处理注册，请稍后重试。' },
          { status: 503 },
        )
      : NextResponse.redirect(
          getApplicationRedirectUrl('/auth/sign-up?error=temporary'),
          303,
        );
  }

  return json
    ? NextResponse.json(
        {
          message: '如果该邮箱可以注册，请查看收件箱中的验证邮件。',
        },
        { status: 202 },
      )
    : NextResponse.redirect(
        getApplicationRedirectUrl('/auth/verify?sent=1'),
        303,
      );
}
