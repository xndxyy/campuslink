import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/auth-service';
import { getDb } from '@/lib/db';
import {
  authorizeAssetRead,
  type ContentAdapter,
  type ContentActor,
  ContentAuthenticationRequiredError,
  ContentForbiddenError,
} from '@/lib/domain/content-service';
import { createPresignedGetUrl } from '@/lib/storage/client';

interface AssetReadDependencies {
  authorize?: (
    actor: ContentActor | null,
    id: string,
  ) => Promise<{ contentType: string; kind: string; storageKey: string }>;
  resolveUser?: typeof getCurrentUser;
  sign?: typeof createPresignedGetUrl;
}

export async function handleAssetRead(
  id: string,
  dependencies: AssetReadDependencies = {},
) {
  try {
    const user = await (dependencies.resolveUser ?? getCurrentUser)();
    const actor = user
      ? { campusId: user.campusId, id: user.id, role: user.role }
      : null;
    const asset = dependencies.authorize
      ? await dependencies.authorize(actor, id)
      : await authorizeAssetRead(
          getDb() as unknown as ContentAdapter,
          actor,
          id,
        );
    const inline = asset.kind.endsWith('_IMAGE');
    const url = await (dependencies.sign ?? createPresignedGetUrl)(
      asset.storageKey,
      asset.contentType,
      inline ? 'inline' : 'attachment',
    );
    const response = NextResponse.redirect(url, 307);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    if (!inline) response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    if (error instanceof ContentAuthenticationRequiredError)
      return NextResponse.json(
        { message: 'Sign in is required to download this asset.' },
        { status: 401 },
      );
    if (error instanceof ContentForbiddenError)
      return NextResponse.json(
        { message: 'Asset access is forbidden.' },
        { status: 403 },
      );
    return NextResponse.json(
      { message: 'Unable to read asset.' },
      { status: 500 },
    );
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleAssetRead(id);
}
