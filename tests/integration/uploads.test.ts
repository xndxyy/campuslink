import { createHash, randomUUID } from 'node:crypto';

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbClient } from '@/lib/db';
import { handleAssetScanCallback } from '@/app/api/internal/uploads/scan-result/route';
import {
  type ContentAdapter,
  createResource,
} from '@/lib/domain/content-service';
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
import {
  createPrismaAssetScanRepository,
  recordAssetScanResult,
} from '@/lib/storage/scanning';
import { validateUpload } from '@/lib/validation/upload';
import { hasCompleteIntegrationEnvironment } from '@/tests/helpers/integration-environment';

const hasIntegrationEnvironment = hasCompleteIntegrationEnvironment(
  process.env,
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

  it('keeps a real PDF unpublished until an authenticated scanner records CLEAN', async () => {
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

    const bytes = Buffer.alloc(1_024, 1);
    const uploadResponse = await fetch(intent.uploadUrl, {
      body: bytes,
      headers: intent.requiredHeaders,
      method: 'PUT',
    });
    expect(uploadResponse.ok).toBe(true);
    await expect(
      completeUpload(ownerId, intent.assetId, dependencies),
    ).resolves.toEqual({ assetId: intent.assetId, status: 'READY' });
    await expect(
      db.asset.findUniqueOrThrow({ where: { id: intent.assetId } }),
    ).resolves.toMatchObject({ scanStatus: 'PENDING', status: 'READY' });

    const actor = {
      campusId,
      emailVerifiedAt: new Date(),
      id: ownerId,
      role: 'STUDENT' as const,
      status: 'ACTIVE' as const,
    };
    const input = {
      assetIds: [intent.assetId],
      customTags: ['security'],
      presetTagIds: [],
      summary: 'A real integration document awaiting a malware verdict.',
      title: 'Scanner integration resource',
    };
    await expect(
      createResource(db as unknown as ContentAdapter, actor, input, {
        requireCleanDocuments: true,
      }),
    ).rejects.toThrow('Document malware scan has not passed');

    const scannerSecret = 'scanner-integration-secret-0123456789';
    const scanResponse = await handleAssetScanCallback(
      new Request('http://localhost/api/internal/uploads/scan-result', {
        body: JSON.stringify({
          assetId: intent.assetId,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          verdict: 'CLEAN',
        }),
        headers: {
          authorization: `Bearer ${scannerSecret}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      }),
      {
        record: (input) =>
          recordAssetScanResult(input, {
            repository: createPrismaAssetScanRepository(db),
            storage: createS3UploadStorage(),
          }),
        secret: scannerSecret,
      },
    );
    expect(scanResponse.status).toBe(200);
    await expect(
      db.asset.findUniqueOrThrow({ where: { id: intent.assetId } }),
    ).resolves.toMatchObject({ scanStatus: 'CLEAN', status: 'READY' });
    await expect(
      createResource(db as unknown as ContentAdapter, actor, input, {
        requireCleanDocuments: true,
      }),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('rejects an infected real object before deleting it from storage', async () => {
    const validated = validateUpload({
      contentType: 'application/pdf',
      fileName: 'infected.pdf',
      kind: 'RESOURCE_DOCUMENT',
      sizeBytes: 64,
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
    const asset = await db.asset.findUniqueOrThrow({
      where: { id: intent.assetId },
    });
    storageKeys.push(asset.storageKey);
    const bytes = Buffer.alloc(64, 9);
    const upload = await fetch(intent.uploadUrl, {
      body: bytes,
      headers: intent.requiredHeaders,
      method: 'PUT',
    });
    expect(upload.ok).toBe(true);
    await completeUpload(ownerId, intent.assetId, dependencies);

    await recordAssetScanResult(
      {
        assetId: intent.assetId,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        verdict: 'INFECTED',
      },
      {
        repository: createPrismaAssetScanRepository(db),
        storage: createS3UploadStorage(),
      },
    );
    await expect(
      db.asset.findUniqueOrThrow({ where: { id: intent.assetId } }),
    ).resolves.toMatchObject({ scanStatus: 'INFECTED', status: 'REJECTED' });

    const config = getStorageConfig();
    const client = createS3Client(config);
    try {
      await expect(
        client.send(
          new HeadObjectCommand({
            Bucket: config.bucket,
            Key: asset.storageKey,
          }),
        ),
      ).rejects.toBeDefined();
    } finally {
      client.destroy();
    }
  });

  it('allows only one racing write and rejects later overwrite reuse', async () => {
    const validated = validateUpload({
      contentType: 'application/pdf',
      fileName: 'write-once.pdf',
      kind: 'RESOURCE_DOCUMENT',
      sizeBytes: 256,
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
    const asset = await db.asset.findUniqueOrThrow({
      where: { id: intent.assetId },
    });
    storageKeys.push(asset.storageKey);
    const put = () =>
      fetch(intent.uploadUrl, {
        body: Buffer.alloc(256, 2),
        headers: intent.requiredHeaders,
        method: 'PUT',
      });

    const racing = await Promise.all([put(), put()]);
    expect(racing.filter((response) => response.ok)).toHaveLength(1);
    expect(
      racing.find((response) => !response.ok)?.status,
    ).toBeGreaterThanOrEqual(409);

    const overwrite = await put();
    expect(overwrite.ok).toBe(false);
    expect([409, 412]).toContain(overwrite.status);
    await expect(
      completeUpload(ownerId, intent.assetId, dependencies),
    ).resolves.toEqual({ assetId: intent.assetId, status: 'READY' });
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
