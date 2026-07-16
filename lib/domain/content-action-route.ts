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
  deleteOwnedContent,
  editOwnedContent,
  submitOwnedDraft,
} from './content-service';
import {
  updateCampusWorkSchema,
  updateMarketplaceItemSchema,
  updateResourceSchema,
} from '@/lib/validation/content';
import { TagValidationError } from '@/lib/validation/tags';
import { toContentValidationError } from '@/lib/validation/content-errors';
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
  remove?: typeof deleteOwnedContent;
  resolveUser?: CurrentUserResolver;
}

export async function handleContentDelete(
  request: Request,
  kind: ContentKind,
  id: string,
  dependencies: ContentActionDependencies = {},
) {
  if (!isSameOriginAuthRequest(request)) {
    return NextResponse.json({ message: '请求来源无效。' }, { status: 403 });
  }
  try {
    const user = await requireVerifiedUser(dependencies.resolveUser);
    const adapter =
      dependencies.adapter ?? (getDb() as unknown as ContentAdapter);
    const result = await (dependencies.remove ?? deleteOwnedContent)(
      adapter,
      { campusId: user.campusId, id: user.id, role: user.role },
      kind,
      id,
    );
    return NextResponse.json({
      ...result,
      message: result.archived
        ? '内容已从你的发布中移除；举报处理完成后将永久删除。'
        : '内容已永久删除。',
    });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ message: '请先登录。' }, { status: 401 });
    }
    if (error instanceof VerificationRequiredError) {
      return NextResponse.json(
        { message: '需要已验证且状态正常的账号。' },
        { status: 403 },
      );
    }
    if (error instanceof ContentNotFoundError) {
      return NextResponse.json({ message: '未找到该内容。' }, { status: 404 });
    }
    if (error instanceof ContentConflictError) {
      return NextResponse.json(
        { message: '内容状态已变化，请刷新后重试。' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { message: '暂时无法删除内容，请稍后重试。' },
      { status: 500 },
    );
  }
}

export async function handleContentAction(
  request: Request,
  kind: ContentKind,
  id: string,
  dependencies: ContentActionDependencies = {},
) {
  if (!isSameOriginAuthRequest(request))
    return NextResponse.json({ message: '请求来源无效。' }, { status: 403 });
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
        { message: '内容操作无效。' },
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
          : updateCampusWorkSchema;
    const parsedEdit =
      body?.action === 'edit' ? editSchema.safeParse(body.data) : null;
    if (parsedEdit && !parsedEdit.success) {
      return NextResponse.json(toContentValidationError(parsedEdit.error), {
        status: 400,
      });
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
      return NextResponse.json({ message: '内容操作无效。' }, { status: 400 });
    return NextResponse.json(
      result.status === 'PENDING'
        ? { ...result, message: '内容正在人工审核。' }
        : result,
    );
  } catch (error) {
    if (error instanceof AuthenticationRequiredError)
      return NextResponse.json({ message: '请先登录。' }, { status: 401 });
    if (error instanceof VerificationRequiredError)
      return NextResponse.json(
        { message: '需要已验证且状态正常的账号。' },
        { status: 403 },
      );
    if (error instanceof ContentNotFoundError)
      return NextResponse.json({ message: '未找到该内容。' }, { status: 404 });
    if (error instanceof ContentConflictError)
      return NextResponse.json(
        { message: '内容状态已变化，请刷新后重试。' },
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
      return NextResponse.json(toContentValidationError(error), {
        status: 400,
      });
    return NextResponse.json(
      { message: '暂时无法更新内容，请稍后重试。' },
      { status: 500 },
    );
  }
}
