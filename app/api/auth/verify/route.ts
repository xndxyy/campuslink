import { NextResponse } from 'next/server';

import { verifyEmailToken } from '@/lib/auth/auth-service';
import { createInMemoryRateLimiter } from '@/lib/auth/rate-limit';

export const runtime = 'nodejs';

const rateLimiter = createInMemoryRateLimiter({
  limit: 10,
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

async function getToken(request: Request): Promise<string> {
  const payload = wantsJson(request)
    ? await request.json().catch(() => null)
    : Object.fromEntries(await request.formData());

  return typeof payload === 'object' && payload !== null && 'token' in payload
    ? String(payload.token)
    : '';
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
          new URL('/auth/verify?error=rate-limit', request.url),
          303,
        );
    response.headers.set('Retry-After', String(rateLimit.retryAfterSeconds));
    return response;
  }

  const verified = await verifyEmailToken(await getToken(request));
  if (!verified) {
    return json
      ? NextResponse.json(
          { message: 'Verification link is invalid or expired.' },
          { status: 400 },
        )
      : NextResponse.redirect(
          new URL('/auth/verify?error=invalid', request.url),
          303,
        );
  }

  return json
    ? NextResponse.json({ message: 'E-mail verified.' })
    : NextResponse.redirect(
        new URL('/auth/sign-in?verified=1', request.url),
        303,
      );
}
