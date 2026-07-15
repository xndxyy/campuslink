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
  let previousDefaultCampusSlug: string | undefined;

  beforeAll(() => {
    db = createDbClient();
    previousDefaultCampusSlug = process.env.DEFAULT_CAMPUS_SLUG;
  });

  afterEach(async () => {
    if (email) {
      await db.verificationToken.deleteMany({ where: { identifier: email } });
    }
    if (campusId) {
      await db.user.deleteMany({ where: { campusId } });
      await db.campus.delete({ where: { id: campusId } });
    }
    campusId = undefined;
    email = undefined;
  });

  afterAll(async () => {
    if (previousDefaultCampusSlug === undefined) {
      delete process.env.DEFAULT_CAMPUS_SLUG;
    } else {
      process.env.DEFAULT_CAMPUS_SLUG = previousDefaultCampusSlug;
    }
    await db.$disconnect();
  });

  it('registers member@qq.com in the active default campus and keeps it credential-free until one-time activation', async () => {
    const suffix = randomUUID();
    const defaultCampusSlug = `auth-flow-${suffix}`;
    email = 'member@qq.com';
    process.env.DEFAULT_CAMPUS_SLUG = defaultCampusSlug;

    const campus = await db.campus.create({
      data: {
        name: 'Authentication Flow Test Campus',
        slug: defaultCampusSlug,
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
    };

    await signUpWithPassword(request, { db, mailer });

    const pendingUser = await db.user.findUniqueOrThrow({
      where: { email },
    });
    expect(pendingUser.campusId).toBe(campus.id);
    expect(pendingUser.status).toBe('PENDING_VERIFICATION');
    expect(pendingUser.passwordHash).toBeNull();
    await expect(
      signInWithPassword({ ...request, password: 'SafeCampus!42' }, { db }),
    ).resolves.toBeNull();

    if (!verificationUrl) {
      throw new Error('Test mailer did not receive a verification link.');
    }
    const verificationToken = new URL(verificationUrl).searchParams.get(
      'token',
    );
    if (!verificationToken) {
      throw new Error('Verification link did not contain a token.');
    }

    await expect(
      verifyEmailToken(verificationToken, 'SafeCampus!42', { db }),
    ).resolves.toBe(true);
    await expect(
      verifyEmailToken(verificationToken, 'SafeCampus!42', { db }),
    ).resolves.toBe(false);

    const session = await signInWithPassword(
      { ...request, password: 'SafeCampus!42' },
      { db },
    );
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

  it('returns the same no-op for an inactive or missing default campus', async () => {
    const suffix = randomUUID();
    const inactiveSlug = `inactive-auth-flow-${suffix}`;
    email = `inactive-${suffix}@qq.com`;
    process.env.DEFAULT_CAMPUS_SLUG = inactiveSlug;
    const campus = await db.campus.create({
      data: {
        isActive: false,
        name: 'Inactive Authentication Flow Test Campus',
        slug: inactiveSlug,
      },
    });
    campusId = campus.id;
    const mailer: VerificationMailer = {
      sendVerificationEmail: async () => {
        throw new Error('Inactive campus must not send verification mail.');
      },
    };

    await expect(
      signUpWithPassword(
        { email, name: 'Inactive Campus Member' },
        { db, mailer },
      ),
    ).resolves.toBeUndefined();
    await expect(db.user.findUnique({ where: { email } })).resolves.toBeNull();

    process.env.DEFAULT_CAMPUS_SLUG = `missing-auth-flow-${suffix}`;
    await expect(
      signUpWithPassword(
        { email, name: 'Missing Campus Member' },
        { db, mailer },
      ),
    ).resolves.toBeUndefined();
    await expect(db.user.findUnique({ where: { email } })).resolves.toBeNull();
  });
});
