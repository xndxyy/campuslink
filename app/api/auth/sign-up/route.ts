import { NextResponse } from 'next/server';

import { signUpWithPassword } from '@/lib/auth/auth-service';
import { signUpSchema } from '@/lib/auth/credentials';
import { createInMemoryRateLimiter } from '@/lib/auth/rate-limit';

export const runtime = 'nodejs';

const rateLimiter = createInMemoryRateLimiter({
  limit: 5,
  windowMs: 15 * 60_000,
});

function wantsJson(request: Request): boolean {
  return (
    request.headers.get('content-type')?.includes('application/json') ?? false
  );
}

function getClientKey(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown-client'
  );
}

async function getBody(request: Request): Promise<unknown> {
  if (wantsJson(request)) {
    return request.json().catch(() => null);
  }

  return Object.fromEntries(await request.formData());
}

export async function POST(request: Request) {
  const json = wantsJson(request);
  const rateLimit = rateLimiter.consume(getClientKey(request));
  if (!rateLimit.allowed) {
    const response = json
      ? NextResponse.json(
          { message: 'Please try again later.' },
          { status: 429 },
        )
      : NextResponse.redirect(
          new URL('/auth/sign-up?error=rate-limit', request.url),
          303,
        );
    response.headers.set('Retry-After', String(rateLimit.retryAfterSeconds));
    return response;
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

  const emailRateLimit = rateLimiter.consume(`email:${parsed.data.email}`);
  if (!emailRateLimit.allowed) {
    const response = json
      ? NextResponse.json(
          { message: 'Please try again later.' },
          { status: 429 },
        )
      : NextResponse.redirect(
          new URL('/auth/sign-up?error=rate-limit', request.url),
          303,
        );
    response.headers.set(
      'Retry-After',
      String(emailRateLimit.retryAfterSeconds),
    );
    return response;
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
