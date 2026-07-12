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

import {
  type ContentActor,
  type ContentAdapter,
  ContentConflictError,
} from './content-service';

export interface CreateRouteDependencies<T> {
  create?: (actor: ContentActor, input: T) => Promise<unknown>;
  resolveUser?: CurrentUserResolver;
}

export async function handleCreateContent<T>(
  request: Request,
  schema: z.ZodType<T>,
  service: (
    adapter: ContentAdapter,
    actor: ContentActor,
    input: T,
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
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { message: 'Invalid content details.' },
        { status: 400 },
      );
    }
    const actor = { campusId: user.campusId, id: user.id, role: user.role };
    const result = dependencies.create
      ? await dependencies.create(actor, parsed.data)
      : await service(getDb() as unknown as ContentAdapter, actor, parsed.data);
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
    if (error instanceof ContentConflictError) {
      return NextResponse.json(
        { message: 'Content or asset state conflict.' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { message: 'Unable to create content.' },
      { status: 500 },
    );
  }
}
