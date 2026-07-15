import { NextResponse } from 'next/server';
import {
  AuthenticationRequiredError,
  requireVerifiedUser,
  type CurrentUserResolver,
  VerificationRequiredError,
} from '@/lib/auth/guards';
import { isSameOriginAuthRequest } from '@/lib/auth/request-security';
import { getDb } from '@/lib/db';
import { JsonBodyError, readBoundedJson } from '@/lib/security/request-body';
import {
  archiveOwnedContent,
  type ContentAdapter,
  type ContentKind,
  ContentConflictError,
  ContentNotFoundError,
  editOwnedContent,
  submitOwnedDraft,
} from './content-service';
import {
  updateCampusWorkSchema,
  updateJobSchema,
  updateMarketplaceItemSchema,
  updateResourceSchema,
} from '@/lib/validation/content';
import { TagValidationError } from '@/lib/validation/tags';
import {
  ContentBlockedError,
  createConfiguredPublishingPolicy,
  type ConfiguredPublishingAssessmentAdapter,
  type PublishingAssessmentPolicy,
} from '@/lib/moderation/content-assessment';

export interface ContentActionDependencies {
  adapter?: ContentAdapter;
  edit?: typeof editOwnedContent;
  publishing?: PublishingAssessmentPolicy;
  resolveUser?: CurrentUserResolver;
}

export async function handleContentAction(
  request: Request,
  kind: ContentKind,
  id: string,
  dependencies: ContentActionDependencies = {},
) {
  if (!isSameOriginAuthRequest(request))
    return NextResponse.json(
      { message: 'Invalid request origin.' },
      { status: 403 },
    );
  try {
    const user = await requireVerifiedUser(dependencies.resolveUser);
    const body = (await readBoundedJson(request).catch((error) => error)) as
      | JsonBodyError
      | {
          action?: unknown;
          data?: unknown;
        };
    if (body instanceof JsonBodyError) {
      return NextResponse.json(
        { message: 'Invalid content action.' },
        { status: body.status },
      );
    }
    const actor = {
      campusId: user.campusId,
      emailVerifiedAt: user.emailVerifiedAt,
      id: user.id,
      role: user.role,
      status: user.status,
    };
    const adapter =
      dependencies.adapter ?? (getDb() as unknown as ContentAdapter);
    const publishing =
      dependencies.publishing ??
      (!dependencies.adapter
        ? createConfiguredPublishingPolicy(
            adapter as ContentAdapter & ConfiguredPublishingAssessmentAdapter,
          )
        : undefined);
    const editSchema =
      kind === 'resource'
        ? updateResourceSchema
        : kind === 'marketplace'
          ? updateMarketplaceItemSchema
          : kind === 'campus-work'
            ? updateCampusWorkSchema
            : updateJobSchema;
    const parsedEdit =
      body?.action === 'edit' ? editSchema.safeParse(body.data) : null;
    if (parsedEdit && !parsedEdit.success) {
      return NextResponse.json(
        { message: 'Invalid content details.' },
        { status: 400 },
      );
    }
    const result = parsedEdit?.success
      ? await (dependencies.edit ?? editOwnedContent)(
          adapter,
          actor,
          kind,
          id,
          parsedEdit.data,
        )
      : body?.action === 'archive'
        ? await archiveOwnedContent(adapter, actor, kind, id)
        : body?.action === 'submit'
          ? await submitOwnedDraft(
              adapter,
              actor,
              kind,
              id,
              undefined,
              publishing,
            )
          : null;
    if (!result)
      return NextResponse.json(
        { message: 'Invalid content action.' },
        { status: 400 },
      );
    return NextResponse.json(
      result.status === 'PENDING'
        ? { ...result, message: '内容正在人工审核。' }
        : result,
    );
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
    if (error instanceof ContentBlockedError)
      return NextResponse.json(
        {
          categories: error.categories,
          code: error.code,
          reason: error.reason,
          suggestion: error.suggestion,
        },
        { status: 400 },
      );
    if (error instanceof TagValidationError)
      return NextResponse.json(
        { message: 'Invalid content details.' },
        { status: 400 },
      );
    return NextResponse.json(
      { message: 'Unable to update content.' },
      { status: 500 },
    );
  }
}
