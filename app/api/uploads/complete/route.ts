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
      { message: 'Invalid request origin.' },
      { status: 403 },
    );
  }
  if (!(
    request.headers.get('content-type')?.includes('application/json') ?? false
  )) {
    return NextResponse.json(
      { message: 'Invalid upload completion details.' },
      { status: 400 },
    );
  }

  try {
    const user = await requireVerifiedUser(dependencies.resolveUser);
    const body = await readBoundedJson(request).catch((error) => error);
    if (body instanceof JsonBodyError) {
      return NextResponse.json(
        { message: 'Invalid upload completion details.' },
        { status: body.status },
      );
    }
    const parsed = completeUploadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { message: 'Invalid upload completion details.' },
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
        { message: 'Authentication is required.' },
        { status: 401 },
      );
    }
    if (
      error instanceof VerificationRequiredError ||
      error instanceof UploadForbiddenError
    ) {
      return NextResponse.json(
        { message: 'Upload completion is forbidden.' },
        { status: 403 },
      );
    }
    if (
      error instanceof UploadConflictError ||
      error instanceof UploadNotFoundError ||
      error instanceof StorageObjectNotFoundError
    ) {
      return NextResponse.json(
        { message: 'Upload cannot be completed.' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { message: 'Unable to complete upload.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return handleCompleteUpload(request);
}
