import { NextRequest, NextResponse } from 'next/server';

import { buildSecurityHeaders } from '@/lib/security/headers';
import { MAX_JSON_BODY_BYTES } from '@/lib/security/request-body';

const sensitivePath =
  /^(?:\/admin|\/me|\/auth|\/api\/(?:admin|auth|assets|internal|marketplace\/[^/]+\/contact))/;

export function proxy(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
    Number.isFinite(contentLength) &&
    contentLength > MAX_JSON_BODY_BYTES
  ) {
    return NextResponse.json(
      { message: 'Request body is too large.' },
      { status: 413 },
    );
  }

  const security = buildSecurityHeaders(
    process.env.NODE_ENV === 'production' ? 'production' : 'development',
    process.env.S3_ENDPOINT,
    process.env.S3_BUCKET,
    process.env.S3_FORCE_PATH_STYLE === 'true',
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', security.nonce);
  requestHeaders.set(
    'Content-Security-Policy',
    security.headers['Content-Security-Policy'],
  );
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(security.headers)) {
    if (name !== 'Content-Security-Policy') response.headers.set(name, value);
  }
  response.headers.set(
    'Content-Security-Policy',
    security.headers['Content-Security-Policy'],
  );
  if (sensitivePath.test(request.nextUrl.pathname)) {
    response.headers.set('Cache-Control', 'private, no-store');
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
