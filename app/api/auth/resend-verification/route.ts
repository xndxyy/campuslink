import { NextResponse } from 'next/server';

import { resendVerificationEmail } from '@/lib/auth/auth-service';
import { resendVerificationSchema } from '@/lib/auth/credentials';
import { createEnvironmentRateLimiter } from '@/lib/auth/rate-limit';
import {
  getClientRateLimitKey,
  isSameOriginAuthRequest,
} from '@/lib/auth/request-security';
import { JsonBodyError, readBoundedJson } from '@/lib/security/request-body';

export const runtime = 'nodejs';

const rateLimiter = createEnvironmentRateLimiter({ limit: 5 });
const acknowledgement = {
  message:
    'If this address is pending verification, check your e-mail for a verification link.',
};

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
    ? NextResponse.json({ message: 'Please try again later.' }, { status: 429 })
    : NextResponse.redirect(
        new URL('/auth/verify?error=rate-limit', request.url),
        303,
      );
  response.headers.set('Retry-After', String(retryAfterSeconds));
  return response;
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
          new URL('/auth/verify?error=origin', request.url),
          303,
        );
  }

  const clientLimit = await rateLimiter.consume(getClientRateLimitKey(request));
  if (!clientLimit.allowed) {
    return rateLimited(request, json, clientLimit.retryAfterSeconds);
  }

  const body = await getBody(request);
  if (body instanceof JsonBodyError) {
    return NextResponse.json(acknowledgement, { status: body.status });
  }
  const parsed = resendVerificationSchema.safeParse(body);
  if (!parsed.success) {
    return json
      ? NextResponse.json(acknowledgement, { status: 202 })
      : NextResponse.redirect(new URL('/auth/verify?sent=1', request.url), 303);
  }

  const emailLimit = await rateLimiter.consume(`email:${parsed.data.email}`);
  if (!emailLimit.allowed) {
    return rateLimited(request, json, emailLimit.retryAfterSeconds);
  }

  try {
    await resendVerificationEmail(parsed.data.email);
  } catch {
    return json
      ? NextResponse.json(
          { message: 'Unable to send a verification link. Please try again.' },
          { status: 503 },
        )
      : NextResponse.redirect(
          new URL('/auth/verify?error=temporary', request.url),
          303,
        );
  }

  return json
    ? NextResponse.json(acknowledgement, { status: 202 })
    : NextResponse.redirect(new URL('/auth/verify?sent=1', request.url), 303);
}
