import { NextResponse } from 'next/server';

import {
  AuthenticationRequiredError,
  requireVerifiedUser,
  type CurrentUserResolver,
  VerificationRequiredError,
} from '@/lib/auth/guards';
import { isSameOriginAuthRequest } from '@/lib/auth/request-security';
import { JsonBodyError, readBoundedJson } from '@/lib/security/request-body';
import { StorageObjectNotFoundError } from '@/lib/storage/client';
import {
  completeUpload,
  UploadConflictError,
  UploadForbiddenError,
  UploadNotFoundError,
} from '@/lib/storage/policy';
import { completeUploadSchema } from '@/lib/validation/upload';

export const runtime = 'nodejs';

interface CompleteUploadRouteDependencies {
  complete?: (ownerId: string, assetId: string) => Promise<unknown>;
  resolveUser?: CurrentUserResolver;
}

export async function handleCompleteUpload(
  request: Request,
  dependencies: CompleteUploadRouteDependencies = {},
) {
  if (!isSameOriginAuthRequest(request)) {
    return NextResponse.json(
      { message: '请求来源无效。' },
      { status: 403 },
    );
  }
  if (!(
    request.headers.get('content-type')?.includes('application/json') ?? false
  )) {
    return NextResponse.json(
      { message: '上传确认信息无效。' },
      { status: 400 },
    );
  }

  try {
    const user = await requireVerifiedUser(dependencies.resolveUser);
    const body = await readBoundedJson(request).catch((error) => error);
    if (body instanceof JsonBodyError) {
      return NextResponse.json(
        { message: '上传确认信息无效。' },
        { status: body.status },
      );
    }
    const parsed = completeUploadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { message: '上传确认信息无效。' },
        { status: 400 },
      );
    }

    const result = await (dependencies.complete ?? completeUpload)(
      user.id,
      parsed.data.assetId,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json(
        { message: '请先登录。' },
        { status: 401 },
      );
    }
    if (
      error instanceof VerificationRequiredError ||
      error instanceof UploadForbiddenError
    ) {
      return NextResponse.json(
        { message: '无权确认该上传任务。' },
        { status: 403 },
      );
    }
    if (
      error instanceof UploadConflictError ||
      error instanceof UploadNotFoundError ||
      error instanceof StorageObjectNotFoundError
    ) {
      return NextResponse.json(
        { message: '当前上传任务无法完成。' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { message: '暂时无法完成上传，请稍后重试。' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return handleCompleteUpload(request);
}
