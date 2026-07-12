import { describe, expect, it } from 'vitest';

import {
  createS3UploadStorage,
  type StorageConfig,
} from '@/lib/storage/client';

const config: StorageConfig = {
  accessKeyId: 'test-access-key',
  bucket: 'campuslink-test',
  endpoint: 'http://localhost:9000',
  forcePathStyle: true,
  region: 'us-east-1',
  secretAccessKey: 'test-secret-key',
};

describe('S3 upload signing', () => {
  it('signs exact type, length, and write-once precondition', async () => {
    const storage = createS3UploadStorage(config);

    const signed = await storage.createPresignedPutUrl({
      contentType: 'application/pdf',
      expiresInSeconds: 300,
      key: 'campus/user-id/asset-id.pdf',
      sizeBytes: 1_024,
    });

    const signedHeaders = new URL(signed.uploadUrl).searchParams
      .get('X-Amz-SignedHeaders')
      ?.split(';');
    expect(signedHeaders).toEqual([
      'content-length',
      'content-type',
      'host',
      'if-none-match',
    ]);
    expect(signed.requiredHeaders).toEqual({
      'Content-Type': 'application/pdf',
      'If-None-Match': '*',
    });
  });
});
