import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { getDb } from '@/lib/db';
import {
  processDueStorageDeletions,
  type StorageDeletionAdapter,
} from '@/lib/storage/deletion-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StorageDeletionRouteDependencies {
  process?: () => Promise<{
    deleted: number;
    missing: number;
    retried: number;
  }>;
  secret?: string;
}

function secureEqual(actual: string, expected: string) {
  const actualDigest = createHash('sha256').update(actual).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    headers: { 'cache-control': 'no-store' },
    status,
  });

export async function handleStorageDeletions(
  request: Request,
  dependencies: StorageDeletionRouteDependencies = {},
) {
  const configuredSecret =
    dependencies.secret ?? process.env.UPLOAD_CLEANUP_SECRET;
  const secret = configuredSecret?.trim();
  if (!secret || secret.length < 32) {
    return json(
      { message: 'Storage deletion processing is unavailable.' },
      503,
    );
  }
  const authorization = request.headers.get('authorization');
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  if (!token || !secureEqual(token, secret)) {
    return json({ message: 'Authentication is required.' }, 401);
  }
  try {
    const counts = await (
      dependencies.process ??
      (() =>
        processDueStorageDeletions(
          getDb() as unknown as StorageDeletionAdapter,
        ))
    )();
    return json(counts);
  } catch {
    return json({ message: 'Storage deletion processing failed.' }, 500);
  }
}

export function POST(request: Request) {
  return handleStorageDeletions(request);
}
