import 'server-only';

import { cookies } from 'next/headers';

import { getDb } from '@/lib/db';

import {
  createOpaqueToken,
  getCampusEmailDomain,
  hashOpaqueToken,
  hashPassword,
  verifyPassword,
} from './credentials';
import { createEnvironmentMailer, type VerificationMailer } from './mailer';
import type { UserRole } from './permissions';
import type { RateLimiter } from './rate-limit';
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from './session';

const verificationLifetimeMs = 24 * 60 * 60 * 1_000;
const dummyPasswordHash =
  '$2b$12$3PhfWpsS2TCwMa.ASaQKOeM.A7RZOc4xS5b07a0PWAZDvQkQ9t6Mi';

export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';

export interface SessionUser {
  email: string;
  emailVerifiedAt: Date | null;
  id: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
}

type AuthDatabase = ReturnType<typeof getDb>;

interface AuthDependencies {
  appUrl?: string;
  db?: AuthDatabase;
  mailer?: VerificationMailer;
  now?: () => Date;
  rateLimiter?: RateLimiter;
}

export interface SignUpRequest {
  email: string;
  name: string;
  password: string;
}

export interface SignInRequest {
  email: string;
  password: string;
}

export interface CreatedSession {
  expires: Date;
  token: string;
}

function getAppUrl(appUrl: string | undefined): string {
  return appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

function sessionUserFromDatabaseUser(user: {
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
  user: Pick<SessionUser, 'emailVerifiedAt' | 'status'>,
): boolean {
  return user.status === 'ACTIVE' && user.emailVerifiedAt !== null;
}

export async function signUpWithPassword(
  input: SignUpRequest,
  dependencies: AuthDependencies = {},
): Promise<void> {
  const db = dependencies.db ?? getDb();
  const now = dependencies.now ?? (() => new Date());
  const campus = await db.campus.findUnique({
    where: { allowedEmailDomain: getCampusEmailDomain() },
  });

  // The endpoint intentionally returns the same acknowledgement for each path.
  if (!campus?.isActive) {
    return;
  }

  const verificationToken = createOpaqueToken();
  const verificationTokenHash = hashOpaqueToken(verificationToken);
  const passwordHash = await hashPassword(input.password);
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
        passwordHash,
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
    getAppUrl(dependencies.appUrl),
  );
  verificationUrl.searchParams.set('token', verificationToken);
  await (
    dependencies.mailer ?? createEnvironmentMailer()
  ).sendVerificationEmail({
    recipient: input.email,
    verificationUrl: verificationUrl.toString(),
  });
}

export async function verifyEmailToken(
  token: string,
  dependencies: AuthDependencies = {},
): Promise<boolean> {
  if (!token) {
    return false;
  }

  const db = dependencies.db ?? getDb();
  const now = dependencies.now ?? (() => new Date());
  const tokenHash = hashOpaqueToken(token);

  return db.$transaction(async (transaction) => {
    const verification = await transaction.verificationToken.findUnique({
      where: { tokenHash },
    });

    if (!verification || verification.expires <= now()) {
      if (verification) {
        await transaction.verificationToken.delete({
          where: { tokenHash },
        });
      }
      return false;
    }

    const emailRateLimit = dependencies.rateLimiter?.consume(
      `email:${verification.identifier.trim().toLowerCase()}`,
    );
    if (emailRateLimit && !emailRateLimit.allowed) {
      return false;
    }

    const user = await transaction.user.findUnique({
      where: { email: verification.identifier },
      select: { id: true, status: true },
    });

    if (!user || user.status !== 'PENDING_VERIFICATION') {
      await transaction.verificationToken.delete({ where: { tokenHash } });
      return false;
    }

    await transaction.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: now(), status: 'ACTIVE' },
    });
    await transaction.verificationToken.delete({ where: { tokenHash } });
    return true;
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
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

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
  await revokeSessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
}
