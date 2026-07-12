import { randomUUID } from 'node:crypto';

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbClient } from '@/lib/db';
import {
  createS3Client,
  createS3UploadStorage,
  getStorageConfig,
} from '@/lib/storage/client';
import {
  completeUpload,
  createPrismaAssetRepository,
  createUploadIntent,
  UploadForbiddenError,
} from '@/lib/storage/policy';
import { validateUpload } from '@/lib/validation/upload';

const requiredEnvironment = [
  'DATABASE_URL',
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_BUCKET',
  'S3_FORCE_PATH_STYLE',
] as const;
const hasIntegrationEnvironment = requiredEnvironment.every((name) =>
  Boolean(process.env[name]),
);
const describeWithStorage = describe.skipIf(!hasIntegrationEnvironment);

describeWithStorage('direct storage uploads', () => {
  let db!: ReturnType<typeof createDbClient>;
  let campusId!: string;
  let ownerId!: string;
  let otherOwnerId!: string;
  const storageKeys: string[] = [];

  beforeAll(async () => {
    db = createDbClient();
    const config = getStorageConfig();
    const client = createS3Client(config);
    try {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
    }

    const suffix = randomUUID();
    const campus = await db.campus.create({
      data: {
        allowedEmailDomain: `${suffix}.example.test`,
        name: 'Upload Integration Campus',
        slug: `upload-${suffix}`,
      },
    });
    campusId = campus.id;
    const users = await Promise.all(
      ['owner', 'other'].map((name) =>
        db.user.create({
          data: {
            campusId,
            email: `${name}-${suffix}@${suffix}.example.test`,
            emailVerifiedAt: new Date(),
            status: 'ACTIVE',
          },
        }),
      ),
    );
    ownerId = users[0]!.id;
    otherOwnerId = users[1]!.id;
  });

  afterAll(async () => {
    const config = getStorageConfig();
    const client = createS3Client(config);
    await Promise.all(
      storageKeys.map((key) =>
        client.send(
          new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
        ),
      ),
    );
    await db.asset.deleteMany({
      where: { ownerId: { in: [ownerId, otherOwnerId] } },
    });
    await db.user.deleteMany({
      where: { id: { in: [ownerId, otherOwnerId] } },
    });
    await db.campus.delete({ where: { id: campusId } });
    await db.$disconnect();
  });

  it('uploads a PDF and atomically marks the asset ready', async () => {
    const validated = validateUpload({
      contentType: 'application/pdf',
      fileName: 'integration.pdf',
      kind: 'RESOURCE_DOCUMENT',
      sizeBytes: 1_024,
    });
    expect(validated.success).toBe(true);
    if (!validated.success) return;

    const dependencies = {
      repository: createPrismaAssetRepository(db),
      storage: createS3UploadStorage(),
    };
    const intent = await createUploadIntent(
      ownerId,
      validated.data,
      dependencies,
    );
    const asset = await db.asset.findUniqueOrThrow({
      where: { id: intent.assetId },
    });
    storageKeys.push(asset.storageKey);

    const uploadResponse = await fetch(intent.uploadUrl, {
      body: Buffer.alloc(1_024, 1),
      headers: { 'Content-Type': intent.contentType },
      method: 'PUT',
    });
    expect(uploadResponse.ok).toBe(true);
    await expect(
      completeUpload(ownerId, intent.assetId, dependencies),
    ).resolves.toEqual({ assetId: intent.assetId, status: 'READY' });
    await expect(
      db.asset.findUniqueOrThrow({ where: { id: intent.assetId } }),
    ).resolves.toMatchObject({ status: 'READY' });
  });

  it('rejects SVG and oversize intent input before storage', () => {
    expect(
      validateUpload({
        contentType: 'image/svg+xml',
        fileName: 'unsafe.svg',
        kind: 'RESOURCE_IMAGE',
        sizeBytes: 100,
      }).success,
    ).toBe(false);
    expect(
      validateUpload({
        contentType: 'application/pdf',
        fileName: 'large.pdf',
        kind: 'RESOURCE_DOCUMENT',
        sizeBytes: 25 * 1024 * 1024 + 1,
      }).success,
    ).toBe(false);
  });

  it('does not let a second user finalize the first user intent', async () => {
    const validated = validateUpload({
      contentType: 'application/pdf',
      fileName: 'owned.pdf',
      kind: 'RESOURCE_DOCUMENT',
      sizeBytes: 128,
    });
    if (!validated.success) throw new Error('Integration fixture is invalid.');
    const dependencies = {
      repository: createPrismaAssetRepository(db),
      storage: createS3UploadStorage(),
    };
    const intent = await createUploadIntent(
      ownerId,
      validated.data,
      dependencies,
    );

    await expect(
      completeUpload(otherOwnerId, intent.assetId, dependencies),
    ).rejects.toBeInstanceOf(UploadForbiddenError);
  });
});
