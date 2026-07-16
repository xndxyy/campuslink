import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { JsonBodyError, readBoundedJson } from '@/lib/security/request-body';
import {
  recordAssetScanResult,
  ScanResultConflictError,
  ScanResultNotFoundError,
} from '@/lib/storage/scanning';

export const runtime = 'nodejs';

const scanResultSchema = z.object({
  assetId: z.string().min(1).max(128),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  verdict: z.enum(['CLEAN', 'INFECTED', 'ERROR']),
});

interface ScanCallbackDependencies {
  record?: typeof recordAssetScanResult;
  secret?: string;
}

function secureEqual(actual: string, expected: string): boolean {
  const actualDigest = createHash('sha256').update(actual).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

export async function handleAssetScanCallback(
  request: Request,
  dependencies: ScanCallbackDependencies = {},
) {
  const secret = (
    dependencies.secret ?? process.env.UPLOAD_SCANNER_CALLBACK_SECRET
  )?.trim();
  if (!secret || secret.length < 32) {
    return NextResponse.json(
      { message: '文件扫描回调暂时不可用。' },
      { status: 503 },
    );
  }
  const authorization = request.headers.get('authorization');
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  if (!token || !secureEqual(token, secret)) {
    return NextResponse.json({ message: '身份验证失败。' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await readBoundedJson(request);
  } catch (error) {
    return NextResponse.json(
      { message: '扫描结果无效。' },
      { status: error instanceof JsonBodyError ? error.status : 400 },
    );
  }
  const parsed = scanResultSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: '扫描结果无效。' }, { status: 400 });
  }

  try {
    const result = await (dependencies.record ?? recordAssetScanResult)(
      parsed.data,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ScanResultNotFoundError) {
      return NextResponse.json({ message: error.message }, { status: 404 });
    }
    if (error instanceof ScanResultConflictError) {
      return NextResponse.json({ message: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { message: '暂时无法记录扫描结果。' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return handleAssetScanCallback(request);
}
