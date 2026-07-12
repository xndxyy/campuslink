import { NextResponse } from 'next/server';
import {
  AuthenticationRequiredError,
  requireVerifiedUser,
  VerificationRequiredError,
} from '@/lib/auth/guards';
import { isSameOriginAuthRequest } from '@/lib/auth/request-security';
import { getDb } from '@/lib/db';
import {
  archiveOwnedContent,
  type ContentAdapter,
  ContentConflictError,
  ContentNotFoundError,
  returnRejectedToDraft,
  submitOwnedDraft,
} from './content-service';
import type { PublicContentKind } from './public-content';

export async function handleContentAction(
  request: Request,
  kind: PublicContentKind,
  id: string,
) {
  if (!isSameOriginAuthRequest(request))
    return NextResponse.json(
      { message: 'Invalid request origin.' },
      { status: 403 },
    );
  try {
    const user = await requireVerifiedUser();
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
    } | null;
    const actor = { campusId: user.campusId, id: user.id, role: user.role };
    const adapter = getDb() as unknown as ContentAdapter;
    const result =
      body?.action === 'archive'
        ? await archiveOwnedContent(adapter, actor, kind, id)
        : body?.action === 'return-draft'
          ? await returnRejectedToDraft(adapter, actor, kind, id)
          : body?.action === 'submit'
            ? await submitOwnedDraft(adapter, actor, kind, id)
            : null;
    if (!result)
      return NextResponse.json(
        { message: 'Invalid content action.' },
        { status: 400 },
      );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError)
      return NextResponse.json(
        { message: 'Authentication is required.' },
        { status: 401 },
      );
    if (error instanceof VerificationRequiredError)
      return NextResponse.json(
        { message: 'A verified account is required.' },
        { status: 403 },
      );
    if (error instanceof ContentNotFoundError)
      return NextResponse.json(
        { message: 'Content was not found.' },
        { status: 404 },
      );
    if (error instanceof ContentConflictError)
      return NextResponse.json(
        { message: 'Content state conflict.' },
        { status: 409 },
      );
    return NextResponse.json(
      { message: 'Unable to update content.' },
      { status: 500 },
    );
  }
}
