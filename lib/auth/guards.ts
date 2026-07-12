import 'server-only';

import {
  getCurrentUser,
  isVerifiedActiveUser,
  type SessionUser,
} from './auth-service';
import { isRoleAllowed, type UserRole } from './permissions';

export class AuthenticationRequiredError extends Error {
  constructor() {
    super('Authentication is required');
  }
}

export class VerificationRequiredError extends Error {
  constructor() {
    super('A verified account is required');
  }
}

export class InsufficientPermissionsError extends Error {
  constructor() {
    super('Insufficient permissions');
  }
}

export type CurrentUserResolver = () => Promise<SessionUser | null>;

export async function requireUser(
  resolveUser: CurrentUserResolver = getCurrentUser,
): Promise<SessionUser> {
  const user = await resolveUser();

  if (!user) {
    throw new AuthenticationRequiredError();
  }

  return user;
}

export async function requireVerifiedUser(
  resolveUser: CurrentUserResolver = getCurrentUser,
): Promise<SessionUser> {
  const user = await requireUser(resolveUser);

  if (!isVerifiedActiveUser(user)) {
    throw new VerificationRequiredError();
  }

  return user;
}

export async function requireRole(
  allowedRoles: readonly UserRole[],
  resolveUser: CurrentUserResolver = getCurrentUser,
): Promise<SessionUser> {
  const user = await requireVerifiedUser(resolveUser);

  if (!isRoleAllowed(user.role, allowedRoles)) {
    throw new InsufficientPermissionsError();
  }

  return user;
}
