import { NextResponse } from 'next/server';
import type { z } from 'zod';

import {
  AuthenticationRequiredError,
  requireVerifiedUser,
  type CurrentUserResolver,
  VerificationRequiredError,
} from '@/lib/auth/guards';
import { isSameOriginAuthRequest } from '@/lib/auth/request-security';
import { getDb } from '@/lib/db';
import { JsonBodyError, readBoundedJson } from '@/lib/security/request-body';
import { TagValidationError } from '@/lib/validation/tags';
import { toContentValidationError } from '@/lib/validation/content-errors';

import {
  type ContentAdapter,
  ContentConflictError,
  type ContentPublishingPolicy,
  type VerifiedContentActor,
} from './content-service';
import {
  ContentBlockedError,
  createConfiguredPublishingPolicy,
  type ConfiguredPublishingAssessmentAdapter,
} from '@/lib/moderation/content-assessment';

export interface CreateRouteDependencies<T> {
  create?: (actor: VerifiedContentActor, input: T) => Promise<unknown>;
  resolveUser?: CurrentUserResolver;
}

export async function handleCreateContent<T>(
  request: Request,
  schema: z.ZodType<T>,
  service: (
    adapter: ContentAdapter,
    actor: VerifiedContentActor,
    input: T,
    publishing?: ContentPublishingPolicy,
  ) => Promise<unknown>,
  dependencies: CreateRouteDependencies<T> = {},
) {
  if (!isSameOriginAuthRequest(request)) {
    return NextResponse.json(
      { message: 'Invalid request origin.' },
      { status: 403 },
    );
  }
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json(
      { message: 'Invalid content details.' },
      { status: 400 },
    );
  }

  try {
    const user = await requireVerifiedUser(dependencies.resolveUser);
    const body = await readBoundedJson(request).catch((error) => error);
    if (body instanceof JsonBodyError) {
      return NextResponse.json(
        { message: 'Invalid content details.' },
        { status: body.status },
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        toContentValidationError(parsed.error),
        { status: 400 },
      );
    }
    const actor = {
      campusId: user.campusId,
      emailVerifiedAt: user.emailVerifiedAt,
      id: user.id,
      role: user.role,
      status: user.status,
    };
    let result: unknown;
    if (dependencies.create) {
      result = await dependencies.create(actor, parsed.data);
    } else {
      const database = getDb() as unknown as ContentAdapter &
        ConfiguredPublishingAssessmentAdapter;
      result = await service(
        database,
        actor,
        parsed.data,
        createConfiguredPublishingPolicy(database),
      );
    }
    const response =
      result &&
      typeof result === 'object' &&
      (result as { status?: unknown }).status === 'PENDING'
        ? { ...result, message: '内容正在人工审核。' }
        : result;
    return NextResponse.json(response, { status: 201 });
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
    if (error instanceof ContentBlockedError) {
      return NextResponse.json(
        {
          categories: error.categories,
          code: error.code,
          reason: error.reason,
          suggestion: error.suggestion,
        },
        { status: 400 },
      );
    }
    if (error instanceof ContentConflictError) {
      return NextResponse.json(
        { message: 'Content or asset state conflict.' },
        { status: 409 },
      );
    }
    if (error instanceof TagValidationError) {
      return NextResponse.json(
        toContentValidationError(error),
        { status: 400 },
      );
    }
    return NextResponse.json(
      { message: 'Unable to create content.' },
      { status: 500 },
    );
  }
}
