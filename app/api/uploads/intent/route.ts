import { NextResponse } from 'next/server';

import {
  AuthenticationRequiredError,
  requireVerifiedUser,
  type CurrentUserResolver,
  VerificationRequiredError,
} from '@/lib/auth/guards';
import { isSameOriginAuthRequest } from '@/lib/auth/request-security';
import { JsonBodyError, readBoundedJson } from '@/lib/security/request-body';
import {
  createUploadIntent,
  type ValidatedUploadIntent,
} from '@/lib/storage/policy';
import { canCreateUploadIntent } from '@/lib/storage/upload-authorization';
import { uploadIntentSchema } from '@/lib/validation/upload';

export const runtime = 'nodejs';

interface UploadIntentRouteDependencies {
  createIntent?: (
    ownerId: string,
    input: ValidatedUploadIntent,
  ) => Promise<unknown>;
  resolveUser?: CurrentUserResolver;
}

function jsonRequest(request: Request): boolean {
  return (
    request.headers.get('content-type')?.includes('application/json') ?? false
  );
}

export async function handleUploadIntent(
  request: Request,
  dependencies: UploadIntentRouteDependencies = {},
) {
  if (!isSameOriginAuthRequest(request)) {
    return NextResponse.json(
      { message: 'Invalid request origin.' },
      { status: 403 },
    );
  }
  if (!jsonRequest(request)) {
    return NextResponse.json(
      { message: 'Invalid upload details.' },
      { status: 400 },
    );
  }

  try {
    const user = await requireVerifiedUser(dependencies.resolveUser);
    const body = await readBoundedJson(request).catch((error) => error);
    if (body instanceof JsonBodyError) {
      return NextResponse.json(
        { message: 'Invalid upload details.' },
        { status: body.status },
      );
    }
    const parsed = uploadIntentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { message: 'Invalid upload details.' },
        { status: 400 },
      );
    }
    if (!canCreateUploadIntent(user.role, parsed.data.kind)) {
      return NextResponse.json(
        { message: 'Insufficient permissions.' },
        { status: 403 },
      );
    }

    const result = await (dependencies.createIntent ?? createUploadIntent)(
      user.id,
      parsed.data,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json(
        { message: 'Authentication is required.' },
        { status: 401 },
      );
    }
    if (error instanceof VerificationRequiredError) {
      return NextResponse.json(
        { message: 'A verified account is required.' },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { message: 'Unable to create upload.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return handleUploadIntent(request);
}
