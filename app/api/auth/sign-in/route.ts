import { NextResponse } from 'next/server';

import { signInWithPassword } from '@/lib/auth/auth-service';
import { signInSchema } from '@/lib/auth/credentials';
import { createInMemoryRateLimiter } from '@/lib/auth/rate-limit';
import {
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/session';

export const runtime = 'nodejs';

const rateLimiter = createInMemoryRateLimiter({
  limit: 10,
  windowMs: 15 * 60_000,
});
const genericFailure = { message: 'Invalid e-mail or password.' };

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
          new URL('/auth/sign-in?error=rate-limit', request.url),
          303,
        );
    response.headers.set('Retry-After', String(rateLimit.retryAfterSeconds));
    return response;
  }

  const parsed = signInSchema.safeParse(await getBody(request));
  if (!parsed.success) {
    return json
      ? NextResponse.json(genericFailure, { status: 401 })
      : NextResponse.redirect(
          new URL('/auth/sign-in?error=invalid', request.url),
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
          new URL('/auth/sign-in?error=rate-limit', request.url),
          303,
        );
    response.headers.set(
      'Retry-After',
      String(emailRateLimit.retryAfterSeconds),
    );
    return response;
  }

  const session = await signInWithPassword(parsed.data);
  if (!session) {
    return json
      ? NextResponse.json(genericFailure, { status: 401 })
      : NextResponse.redirect(
          new URL('/auth/sign-in?error=invalid', request.url),
          303,
        );
  }

  const response = json
    ? NextResponse.json({ message: 'Signed in.' })
    : NextResponse.redirect(new URL('/', request.url), 303);
  response.cookies.set({
    ...getSessionCookieOptions(),
    expires: session.expires,
    name: SESSION_COOKIE_NAME,
    value: session.token,
  });
  return response;
}
