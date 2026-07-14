import 'server-only';

import { cookies } from 'next/headers';

import { getDb } from '@/lib/db';
import { getDefaultCampusSlug } from '@/lib/config';

import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  verifyPassword,
} from './credentials';
import { createEnvironmentMailer, type VerificationMailer } from './mailer';
import type { UserRole } from './permissions';
import { getApplicationUrl } from './request-security';
import { getSessionCookieName, SESSION_MAX_AGE_SECONDS } from './session';

const verificationLifetimeMs = 24 * 60 * 60 * 1_000;
const dummyPasswordHash =
  '$2b$12$3PhfWpsS2TCwMa.ASaQKOeM.A7RZOc4xS5b07a0PWAZDvQkQ9t6Mi';

export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';

export interface SessionUser {
  campusId: string;
  email: string;
  emailVerifiedAt: Date | null;
  id: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
}

export interface VerifiedSessionUser extends SessionUser {
  emailVerifiedAt: Date;
  status: 'ACTIVE';
}

type AuthDatabase = ReturnType<typeof getDb>;

interface AuthDependencies {
  appUrl?: string;
  db?: AuthDatabase;
  mailer?: VerificationMailer;
  now?: () => Date;
}

export interface SignUpRequest {
  email: string;
  name: string;
}

export interface SignInRequest {
  email: string;
  password: string;
}

export interface CreatedSession {
  expires: Date;
  token: string;
}

function sessionUserFromDatabaseUser(user: {
  campusId: string;
  email: string;
  emailVerifiedAt: Date | null;
  id: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
}): SessionUser {
  return user;
}

export function isVerifiedActiveUser(
  user: SessionUser,
): user is VerifiedSessionUser {
  return user.status === 'ACTIVE' && user.emailVerifiedAt !== null;
}

export async function signUpWithPassword(
  input: SignUpRequest,
  dependencies: AuthDependencies = {},
): Promise<void> {
  const db = dependencies.db ?? getDb();
  const now = dependencies.now ?? (() => new Date());
  const campus = await db.campus.findFirst({
    where: { isActive: true, slug: getDefaultCampusSlug() },
  });

  // The endpoint intentionally returns the same acknowledgement for each path.
  if (!campus) {
    return;
  }

  const verificationToken = createOpaqueToken();
  const verificationTokenHash = hashOpaqueToken(verificationToken);
  const issuedAt = now();

  const created = await db.$transaction(async (transaction) => {
    const existingUser = await transaction.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    if (existingUser) {
      return false;
    }

    await transaction.user.create({
      data: {
        campusId: campus.id,
        email: input.email,
        name: input.name,
        status: 'PENDING_VERIFICATION',
      },
    });
    await transaction.verificationToken.deleteMany({
      where: { identifier: input.email },
    });
    await transaction.verificationToken.create({
      data: {
        expires: new Date(issuedAt.getTime() + verificationLifetimeMs),
        identifier: input.email,
        tokenHash: verificationTokenHash,
      },
    });
    return true;
  });

  if (!created) {
    return;
  }

  const verificationUrl = new URL(
    '/auth/verify',
    getApplicationUrl(dependencies.appUrl),
  );
  verificationUrl.searchParams.set('token', verificationToken);
  await (
    dependencies.mailer ?? createEnvironmentMailer()
  ).sendVerificationEmail({
    recipient: input.email,
    verificationUrl: verificationUrl.toString(),
  });
}

export async function resendVerificationEmail(
  email: string,
  dependencies: AuthDependencies = {},
): Promise<void> {
  const db = dependencies.db ?? getDb();
  const now = dependencies.now ?? (() => new Date());
  const verificationToken = createOpaqueToken();
  const verificationTokenHash = hashOpaqueToken(verificationToken);
  const issuedAt = now();

  const reissued = await db.$transaction(async (transaction) => {
    const user = await transaction.user.findUnique({
      where: { email },
      select: { passwordHash: true, status: true },
    });

    if (user?.status !== 'PENDING_VERIFICATION' || user.passwordHash !== null) {
      return false;
    }

    await transaction.verificationToken.deleteMany({
      where: { identifier: email },
    });
    await transaction.verificationToken.create({
      data: {
        expires: new Date(issuedAt.getTime() + verificationLifetimeMs),
        identifier: email,
        tokenHash: verificationTokenHash,
      },
    });
    return true;
  });

  if (!reissued) {
    return;
  }

  const verificationUrl = new URL(
    '/auth/verify',
    getApplicationUrl(dependencies.appUrl),
  );
  verificationUrl.searchParams.set('token', verificationToken);
  await (
    dependencies.mailer ?? createEnvironmentMailer()
  ).sendVerificationEmail({
    recipient: email,
    verificationUrl: verificationUrl.toString(),
  });
}

export async function verifyEmailToken(
  token: string,
  password: string,
  dependencies: AuthDependencies = {},
): Promise<boolean> {
  if (!token) {
    return false;
  }

  const db = dependencies.db ?? getDb();
  const now = dependencies.now ?? (() => new Date());
  const verificationTime = now();
  const tokenHash = hashOpaqueToken(token);

  return db.$transaction(async (transaction) => {
    const verification = await transaction.verificationToken.findUnique({
      where: { tokenHash },
    });

    if (!verification || verification.expires <= verificationTime) {
      if (verification) {
        await transaction.verificationToken.deleteMany({
          where: { tokenHash },
        });
      }
      return false;
    }

    // The conditional delete is the one-time consume. A concurrent request may
    // read the record, but only one can delete a still-valid hash.
    const consumed = await transaction.verificationToken.deleteMany({
      where: {
        expires: { gt: verificationTime },
        tokenHash,
      },
    });
    if (consumed.count !== 1) {
      return false;
    }

    const activated = await transaction.user.updateMany({
      data: {
        emailVerifiedAt: verificationTime,
        passwordHash: await hashPassword(password),
        status: 'ACTIVE',
      },
      where: {
        email: verification.identifier,
        passwordHash: null,
        status: 'PENDING_VERIFICATION',
      },
    });
    return activated.count === 1;
  });
}

export async function signInWithPassword(
  input: SignInRequest,
  dependencies: AuthDependencies = {},
): Promise<CreatedSession | null> {
  const db = dependencies.db ?? getDb();
  const now = dependencies.now ?? (() => new Date());
  const user = await db.user.findUnique({ where: { email: input.email } });
  const passwordMatches = await verifyPassword(
    input.password,
    user?.passwordHash ?? dummyPasswordHash,
  );

  if (!user || !passwordMatches || !isVerifiedActiveUser(user)) {
    return null;
  }

  const token = createOpaqueToken();
  const expires = new Date(now().getTime() + SESSION_MAX_AGE_SECONDS * 1_000);
  await db.session.create({
    data: {
      expires,
      sessionTokenHash: hashOpaqueToken(token),
      userId: user.id,
    },
  });
  return { expires, token };
}

export async function getSessionUserFromToken(
  token: string,
  db: AuthDatabase = getDb(),
  now = new Date(),
): Promise<SessionUser | null> {
  if (!token) {
    return null;
  }

  const sessionTokenHash = hashOpaqueToken(token);
  const session = await db.session.findUnique({
    include: {
      user: {
        select: {
          campusId: true,
          email: true,
          emailVerifiedAt: true,
          id: true,
          name: true,
          role: true,
          status: true,
        },
      },
    },
    where: { sessionTokenHash },
  });

  if (!session) {
    return null;
  }

  const user = sessionUserFromDatabaseUser(session.user);
  if (session.expires <= now || !isVerifiedActiveUser(user)) {
    await db.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  return user;
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;

  return token ? getSessionUserFromToken(token) : null;
}

export async function revokeSessionToken(
  token: string | undefined,
  db: AuthDatabase = getDb(),
): Promise<void> {
  if (!token) {
    return;
  }

  await db.session.deleteMany({
    where: { sessionTokenHash: hashOpaqueToken(token) },
  });
}

export async function revokeCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  await revokeSessionToken(cookieStore.get(getSessionCookieName())?.value);
}
