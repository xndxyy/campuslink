import { NextResponse } from 'next/server';

import { signUpWithPassword } from '@/lib/auth/auth-service';
import { signUpSchema } from '@/lib/auth/credentials';
import { createEnvironmentRateLimiter } from '@/lib/auth/rate-limit';
import {
  getClientRateLimitKey,
  isSameOriginAuthRequest,
} from '@/lib/auth/request-security';

export const runtime = 'nodejs';

const rateLimiter = createEnvironmentRateLimiter({ limit: 5 });

function wantsJson(request: Request): boolean {
  return (
    request.headers.get('content-type')?.includes('application/json') ?? false
  );
}

function originFailure(request: Request, json: boolean): NextResponse {
  return json
    ? NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 })
    : NextResponse.redirect(
        new URL('/auth/sign-up?error=origin', request.url),
        303,
      );
}

function rateLimited(
  request: Request,
  json: boolean,
  retryAfterSeconds: number,
): NextResponse {
  const response = json
    ? NextResponse.json({ message: 'Please try again later.' }, { status: 429 })
    : NextResponse.redirect(
        new URL('/auth/sign-up?error=rate-limit', request.url),
        303,
      );
  response.headers.set('Retry-After', String(retryAfterSeconds));
  return response;
}

async function getBody(request: Request): Promise<unknown> {
  return wantsJson(request)
    ? request.json().catch(() => null)
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

  const parsed = signUpSchema.safeParse(await getBody(request));
  if (!parsed.success) {
    return json
      ? NextResponse.json(
          { message: 'Invalid registration details.' },
          { status: 400 },
        )
      : NextResponse.redirect(
          new URL('/auth/sign-up?error=invalid', request.url),
          303,
        );
  }

  const emailLimit = await rateLimiter.consume(`email:${parsed.data.email}`);
  if (!emailLimit.allowed) {
    return rateLimited(request, json, emailLimit.retryAfterSeconds);
  }

  try {
    await signUpWithPassword(parsed.data);
  } catch {
    return json
      ? NextResponse.json(
          { message: 'Unable to process registration. Please try again.' },
          { status: 503 },
        )
      : NextResponse.redirect(
          new URL('/auth/sign-up?error=temporary', request.url),
          303,
        );
  }

  return json
    ? NextResponse.json(
        {
          message:
            'If this address is eligible, check your e-mail for a verification link.',
        },
        { status: 202 },
      )
    : NextResponse.redirect(new URL('/auth/verify?sent=1', request.url), 303);
}
