import 'dotenv/config';

import {
  ContentStatus,
  UserRole,
  UserStatus,
} from '../generated/prisma/client';
import { createDbClient } from '../lib/db';

const passwordHash =
  '$2b$12$3PhfWpsS2TCwMa.ASaQKOeM.A7RZOc4xS5b07a0PWAZDvQkQ9t6Mi';

async function main() {
  const db = createDbClient();

  try {
    const campus = await db.campus.upsert({
      where: { slug: 'campuslink' },
      update: {
        name: 'CampusLink Demo Campus',
        allowedEmailDomain: 'campuslink.edu',
        isActive: true,
      },
      create: {
        slug: 'campuslink',
        name: 'CampusLink Demo Campus',
        allowedEmailDomain: 'campuslink.edu',
        isActive: true,
      },
    });

    const student = await db.user.upsert({
      where: { email: 'student@campuslink.edu' },
      update: {
        campusId: campus.id,
        name: 'Verified Student',
        passwordHash,
        identityProvider: null,
        role: UserRole.STUDENT,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
      create: {
        campusId: campus.id,
        name: 'Verified Student',
        email: 'student@campuslink.edu',
        passwordHash,
        role: UserRole.STUDENT,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });

    const moderator = await db.user.upsert({
      where: { email: 'moderator@campuslink.edu' },
      update: {
        campusId: campus.id,
        name: 'Campus Moderator',
        passwordHash,
        identityProvider: null,
        role: UserRole.MODERATOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
      create: {
        campusId: campus.id,
        name: 'Campus Moderator',
        email: 'moderator@campuslink.edu',
        passwordHash,
        role: UserRole.MODERATOR,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });

    await db.user.upsert({
      where: { email: 'admin@campuslink.edu' },
      update: {
        campusId: campus.id,
        name: 'Campus Administrator',
        passwordHash,
        identityProvider: null,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
      create: {
        campusId: campus.id,
        name: 'Campus Administrator',
        email: 'admin@campuslink.edu',
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });

    const resource = await db.resource.findFirst({
      where: { authorId: student.id, title: 'Calculus I Exam Review Notes' },
      select: { id: true },
    });
    if (!resource) {
      await db.resource.create({
        data: {
          authorId: student.id,
          campusId: campus.id,
          title: 'Calculus I Exam Review Notes',
          summary:
            'Approved sample notes covering limits, derivatives, and integration.',
          courseCode: 'MATH-101',
          tags: ['calculus', 'exam-review', 'notes'],
          status: ContentStatus.PUBLISHED,
        },
      });
    }

    const marketplaceItem = await db.marketplaceItem.findFirst({
      where: { sellerId: student.id, title: 'Scientific Calculator' },
      select: { id: true },
    });
    if (!marketplaceItem) {
      await db.marketplaceItem.create({
        data: {
          sellerId: student.id,
          campusId: campus.id,
          title: 'Scientific Calculator',
          description:
            'Approved sample marketplace listing in excellent working condition.',
          priceCents: 1800,
          condition: 'Excellent',
          contact: 'student@campuslink.edu',
          status: ContentStatus.PUBLISHED,
        },
      });
    }

    const jobPost = await db.jobPost.findFirst({
      where: { authorId: moderator.id, title: 'Peer Tutor – Mathematics' },
      select: { id: true },
    });
    if (!jobPost) {
      await db.jobPost.create({
        data: {
          authorId: moderator.id,
          campusId: campus.id,
          company: 'Campus Learning Centre',
          title: 'Peer Tutor – Mathematics',
          description:
            'Approved sample part-time role for a mathematics peer tutor.',
          location: 'Campus Learning Centre',
          payText: '$20/hour',
          status: ContentStatus.PUBLISHED,
        },
      });
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
