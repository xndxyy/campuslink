import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  getSessionUserFromToken,
  signInWithPassword,
  signUpWithPassword,
  verifyEmailToken,
} from '@/lib/auth/auth-service';
import type { VerificationMailer } from '@/lib/auth/mailer';
import { hashOpaqueToken } from '@/lib/auth/credentials';
import { createDbClient } from '@/lib/db';

const describeWithDatabase = describe.skipIf(!process.env.DATABASE_URL);

describeWithDatabase('password authentication flow', () => {
  let db!: ReturnType<typeof createDbClient>;
  let campusId: string | undefined;
  let email: string | undefined;
  let previousCampusDomain: string | undefined;

  beforeAll(() => {
    db = createDbClient();
    previousCampusDomain = process.env.CAMPUS_EMAIL_DOMAIN;
  });

  afterEach(async () => {
    if (email) {
      await db.verificationToken.deleteMany({ where: { identifier: email } });
    }
    if (campusId) {
      await db.campus.delete({ where: { id: campusId } });
    }
    campusId = undefined;
    email = undefined;
  });

  afterAll(async () => {
    if (previousCampusDomain === undefined) {
      delete process.env.CAMPUS_EMAIL_DOMAIN;
    } else {
      process.env.CAMPUS_EMAIL_DOMAIN = previousCampusDomain;
    }
    await db.$disconnect();
  });

  it('signs up, consumes verification once, creates a hashed session, and rejects unverified sign-in', async () => {
    const suffix = randomUUID();
    const domain = `${suffix}.example.test`;
    email = `student-${suffix}@${domain}`;
    process.env.CAMPUS_EMAIL_DOMAIN = domain;

    const campus = await db.campus.create({
      data: {
        allowedEmailDomain: domain,
        name: 'Authentication Flow Test Campus',
        slug: `auth-flow-${suffix}`,
      },
    });
    campusId = campus.id;

    let verificationUrl: string | undefined;
    const mailer: VerificationMailer = {
      async sendVerificationEmail(emailMessage) {
        verificationUrl = emailMessage.verificationUrl;
      },
    };
    const request = {
      email,
      name: 'Authentication Test Student',
      password: 'SafeCampus!42',
    };

    await signUpWithPassword(request, { db, mailer });

    const pendingUser = await db.user.findUniqueOrThrow({
      where: { email },
    });
    expect(pendingUser.status).toBe('PENDING_VERIFICATION');
    expect(pendingUser.passwordHash).not.toBe(request.password);
    await expect(signInWithPassword(request, { db })).resolves.toBeNull();

    if (!verificationUrl) {
      throw new Error('Test mailer did not receive a verification link.');
    }
    const verificationToken = new URL(verificationUrl).searchParams.get(
      'token',
    );
    if (!verificationToken) {
      throw new Error('Verification link did not contain a token.');
    }

    await expect(verifyEmailToken(verificationToken, { db })).resolves.toBe(
      true,
    );
    await expect(verifyEmailToken(verificationToken, { db })).resolves.toBe(
      false,
    );

    const session = await signInWithPassword(request, { db });
    expect(session).not.toBeNull();
    if (!session) {
      throw new Error('Verified user did not receive a session.');
    }

    const storedSession = await db.session.findUnique({
      where: { sessionTokenHash: hashOpaqueToken(session.token) },
    });
    expect(storedSession?.sessionTokenHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      getSessionUserFromToken(session.token, db),
    ).resolves.toMatchObject({
      email,
      status: 'ACTIVE',
    });
  });
});
