import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/auth-service';
import { getDb } from '@/lib/db';
import {
  authorizeAssetRead,
  type ContentAdapter,
  ContentForbiddenError,
} from '@/lib/domain/content-service';
import { createPresignedGetUrl } from '@/lib/storage/client';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    const actor = user
      ? { campusId: user.campusId, id: user.id, role: user.role }
      : null;
    const asset = await authorizeAssetRead(
      getDb() as unknown as ContentAdapter,
      actor,
      id,
    );
    const inline = asset.kind.endsWith('_IMAGE');
    const url = await createPresignedGetUrl(
      asset.storageKey,
      asset.contentType,
      inline ? 'inline' : 'attachment',
    );
    return NextResponse.redirect(url, 307);
  } catch (error) {
    if (error instanceof ContentForbiddenError)
      return NextResponse.json(
        { message: 'Asset is not available.' },
        { status: 404 },
      );
    return NextResponse.json(
      { message: 'Unable to read asset.' },
      { status: 500 },
    );
  }
}
