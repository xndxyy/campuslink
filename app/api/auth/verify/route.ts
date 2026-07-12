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
          { message: 'Invalid request origin.' },
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
          { message: 'Please try again later.' },
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
      { message: 'Verification link is invalid or expired.' },
      { status: body.status },
    );
  }
  const parsed = verificationCompletionSchema.safeParse(body);
  if (!parsed.success) {
    return json
      ? NextResponse.json(
          { message: 'Verification link is invalid or expired.' },
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
          { message: 'Verification link is invalid or expired.' },
          { status: 400 },
        )
      : NextResponse.redirect(
          getApplicationRedirectUrl('/auth/verify?error=invalid'),
          303,
        );
  }

  return json
    ? NextResponse.json({ message: 'E-mail verified.' })
    : NextResponse.redirect(
        getApplicationRedirectUrl('/auth/sign-in?verified=1'),
        303,
      );
}
