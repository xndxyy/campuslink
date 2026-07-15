import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export function POST(request: Request) {
  return NextResponse.redirect(new URL('/api/campus-work', request.url), 308);
}
