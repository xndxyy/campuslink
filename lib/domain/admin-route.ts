import { NextResponse } from 'next/server';

import {
  AuthenticationRequiredError,
  InsufficientPermissionsError,
  VerificationRequiredError,
} from '@/lib/auth/guards';
import {
  AdminConflictError,
  AdminForbiddenError,
  AdminValidationError,
} from './administration';
import {
  AnnouncementConflictError,
  AnnouncementForbiddenError,
  AnnouncementNotFoundError,
  AnnouncementValidationError,
} from './announcements';
import {
  ModerationConflictError,
  ModerationForbiddenError,
  ModerationValidationError,
} from './moderation';

const noStoreHeaders = { 'cache-control': 'no-store' };

export function adminJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...noStoreHeaders, ...init?.headers },
  });
}

export function adminErrorResponse(error: unknown) {
  if (error instanceof AuthenticationRequiredError) {
    return adminJson(
      { message: 'Authentication is required.' },
      { status: 401 },
    );
  }
  if (
    error instanceof VerificationRequiredError ||
    error instanceof InsufficientPermissionsError ||
    error instanceof AnnouncementForbiddenError ||
    error instanceof ModerationForbiddenError ||
    error instanceof AdminForbiddenError
  ) {
    return adminJson({ message: 'Insufficient permissions.' }, { status: 403 });
  }
  if (
    error instanceof ModerationValidationError ||
    error instanceof AnnouncementValidationError ||
    error instanceof AdminValidationError
  ) {
    return adminJson(
      { message: 'Invalid administration request.' },
      { status: 400 },
    );
  }
  if (error instanceof ModerationConflictError) {
    return adminJson(
      { message: 'Moderation state conflict.' },
      { status: 409 },
    );
  }
  if (error instanceof AnnouncementConflictError) {
    return adminJson(
      { message: 'Announcement state conflict.' },
      { status: 409 },
    );
  }
  if (error instanceof AnnouncementNotFoundError) {
    return adminJson(
      { message: 'Announcement was not found.' },
      { status: 404 },
    );
  }
  if (error instanceof AdminConflictError) {
    return adminJson(
      { message: 'Administration state conflict.' },
      { status: 409 },
    );
  }
  return adminJson(
    { message: 'Unable to complete administration request.' },
    { status: 500 },
  );
}
