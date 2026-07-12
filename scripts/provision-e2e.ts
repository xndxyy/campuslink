import 'dotenv/config';

import { readFile } from 'node:fs/promises';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { hash } from 'bcryptjs';

import { createDbClient } from '../lib/db';
import { createS3Client, getStorageConfig } from '../lib/storage/client';
import { assertSafeDestructiveE2eEnvironment } from '../tests/helpers/e2e-database-safety';

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to provision E2E.`);
  return value;
}

async function main() {
  assertSafeDestructiveE2eEnvironment(process.env);
  const verifiedEmail = required('E2E_VERIFIED_EMAIL').toLowerCase();
  const verifiedPassword = required('E2E_VERIFIED_PASSWORD');
  const unverifiedEmail = required('E2E_UNVERIFIED_EMAIL').toLowerCase();
  const unverifiedPassword = required('E2E_UNVERIFIED_PASSWORD');
  const otherEmail = required('E2E_OTHER_EMAIL').toLowerCase();
  const otherPassword = required('E2E_OTHER_PASSWORD');
  const rejectedId = required('E2E_REJECTED_ID');
  const marketplaceId = required('E2E_PUBLISHED_MARKETPLACE_ID');
  if (required('E2E_REJECTED_KIND') !== 'resource') {
    throw new Error(
      'The E2E provisioner currently requires resource fixtures.',
    );
  }

  const db = createDbClient();
  const storageConfig = getStorageConfig();
  const storage = createS3Client(storageConfig);
  try {
    const campus = await db.campus.upsert({
      where: { slug: 'campuslink-e2e' },
      update: {
        allowedEmailDomain: verifiedEmail.split('@').at(-1)!,
        isActive: true,
        name: 'CampusLink E2E Campus',
      },
      create: {
        allowedEmailDomain: verifiedEmail.split('@').at(-1)!,
        isActive: true,
        name: 'CampusLink E2E Campus',
        slug: 'campuslink-e2e',
      },
    });
    const [verifiedHash, unverifiedHash, sellerHash] = await Promise.all([
      hash(verifiedPassword, 12),
      hash(unverifiedPassword, 12),
      hash(otherPassword, 12),
    ]);
    const verified = await db.user.upsert({
      where: { email: verifiedEmail },
      update: {
        campusId: campus.id,
        emailVerifiedAt: new Date(),
        name: 'E2E Verified Student',
        passwordHash: verifiedHash,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
      create: {
        campusId: campus.id,
        email: verifiedEmail,
        emailVerifiedAt: new Date(),
        name: 'E2E Verified Student',
        passwordHash: verifiedHash,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    });
    await db.user.upsert({
      where: { email: unverifiedEmail },
      update: {
        campusId: campus.id,
        emailVerifiedAt: null,
        name: 'E2E Pending Student',
        passwordHash: unverifiedHash,
        role: 'STUDENT',
        status: 'PENDING_VERIFICATION',
      },
      create: {
        campusId: campus.id,
        email: unverifiedEmail,
        name: 'E2E Pending Student',
        passwordHash: unverifiedHash,
        role: 'STUDENT',
        status: 'PENDING_VERIFICATION',
      },
    });
    const seller = await db.user.upsert({
      where: { email: otherEmail },
      update: {
        campusId: campus.id,
        emailVerifiedAt: new Date(),
        name: 'E2E Marketplace Seller',
        passwordHash: sellerHash,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
      create: {
        campusId: campus.id,
        email: otherEmail,
        emailVerifiedAt: new Date(),
        name: 'E2E Marketplace Seller',
        passwordHash: sellerHash,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    });

    await db.resource.upsert({
      where: { id: rejectedId },
      update: {
        authorId: verified.id,
        campusId: campus.id,
        status: 'REJECTED',
        summary: 'A run-scoped rejected resource used to verify resubmission.',
        title: 'E2E rejected resource',
      },
      create: {
        authorId: verified.id,
        campusId: campus.id,
        id: rejectedId,
        status: 'REJECTED',
        summary: 'A run-scoped rejected resource used to verify resubmission.',
        tags: ['e2e'],
        title: 'E2E rejected resource',
      },
    });
    await db.asset.upsert({
      where: { storageKey: 'e2e/rejected-resource.pdf' },
      update: {
        kind: 'RESOURCE_DOCUMENT',
        ownerId: verified.id,
        resourceId: rejectedId,
        scanSha256: '0'.repeat(64),
        scanStatus: 'CLEAN',
        scannedAt: new Date(),
        status: 'READY',
      },
      create: {
        contentType: 'application/pdf',
        kind: 'RESOURCE_DOCUMENT',
        ownerId: verified.id,
        resourceId: rejectedId,
        scanSha256: '0'.repeat(64),
        scanStatus: 'CLEAN',
        scannedAt: new Date(),
        sizeBytes: BigInt(1),
        status: 'READY',
        storageKey: 'e2e/rejected-resource.pdf',
      },
    });
    await db.marketplaceItem.upsert({
      where: { id: marketplaceId },
      update: {
        campusId: campus.id,
        sellerId: seller.id,
        status: 'PUBLISHED',
      },
      create: {
        campusId: campus.id,
        condition: 'GOOD',
        contact: otherEmail,
        description: 'Published marketplace fixture owned by another member.',
        id: marketplaceId,
        pickupArea: 'E2E library',
        priceCents: 1999,
        sellerId: seller.id,
        status: 'PUBLISHED',
        title: 'E2E published marketplace item',
      },
    });
    const image = await readFile('tests/fixtures/marketplace.png');
    const imageKey = 'e2e/published-marketplace.png';
    await storage.send(
      new PutObjectCommand({
        Body: image,
        Bucket: storageConfig.bucket,
        ContentType: 'image/png',
        Key: imageKey,
      }),
    );
    await db.asset.upsert({
      where: { storageKey: imageKey },
      update: {
        contentType: 'image/png',
        kind: 'MARKETPLACE_IMAGE',
        marketplaceItemId: marketplaceId,
        ownerId: seller.id,
        sizeBytes: BigInt(image.byteLength),
        status: 'READY',
      },
      create: {
        contentType: 'image/png',
        kind: 'MARKETPLACE_IMAGE',
        marketplaceItemId: marketplaceId,
        ownerId: seller.id,
        sizeBytes: BigInt(image.byteLength),
        status: 'READY',
        storageKey: imageKey,
      },
    });
  } finally {
    storage.destroy();
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
