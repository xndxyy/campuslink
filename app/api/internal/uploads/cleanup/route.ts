import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { cleanupStaleUploads } from '@/lib/storage/policy';

export const runtime = 'nodejs';

interface CleanupRouteDependencies {
  cleanup?: typeof cleanupStaleUploads;
  secret?: string;
}

function secureEqual(actual: string, expected: string): boolean {
  const actualDigest = createHash('sha256').update(actual).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

export async function handleUploadCleanup(
  request: Request,
  dependencies: CleanupRouteDependencies = {},
) {
  const secret = dependencies.secret ?? process.env.UPLOAD_CLEANUP_SECRET;
  if (!secret) {
    return NextResponse.json(
      { message: 'Upload cleanup is unavailable.' },
      { status: 503 },
    );
  }

  const authorization = request.headers.get('authorization');
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  if (!token || !secureEqual(token, secret)) {
    return NextResponse.json(
      { message: 'Authentication is required.' },
      { status: 401 },
    );
  }

  try {
    const counts = await (dependencies.cleanup ?? cleanupStaleUploads)();
    return NextResponse.json(counts);
  } catch {
    return NextResponse.json(
      { message: 'Upload cleanup failed.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return handleUploadCleanup(request);
}
