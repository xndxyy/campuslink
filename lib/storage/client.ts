import 'server-only';

import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { UploadStorage } from './policy';

export interface StorageConfig {
  accessKeyId: string;
  bucket: string;
  endpoint?: string;
  forcePathStyle: boolean;
  region: string;
  secretAccessKey: string;
}

export class StorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageConfigurationError';
  }
}

export class StorageObjectNotFoundError extends Error {
  constructor() {
    super('The uploaded object was not found.');
    this.name = 'StorageObjectNotFoundError';
  }
}

function required(value: string | undefined, variableName: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new StorageConfigurationError(`${variableName} is required.`);
  }
  return normalized;
}

function parseForcePathStyle(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '') {
    return false;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new StorageConfigurationError(
    'S3_FORCE_PATH_STYLE must be true or false.',
  );
}

export function getStorageConfig(
  environment: NodeJS.ProcessEnv = process.env,
): StorageConfig {
  const endpointValue = environment.S3_ENDPOINT?.trim();
  let endpoint: string | undefined;

  if (endpointValue) {
    let parsed: URL;
    try {
      parsed = new URL(endpointValue);
    } catch {
      throw new StorageConfigurationError(
        'S3_ENDPOINT must be an absolute HTTP(S) URL.',
      );
    }
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password
    ) {
      throw new StorageConfigurationError(
        'S3_ENDPOINT must be an absolute HTTP(S) URL without credentials.',
      );
    }
    if (environment.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
      throw new StorageConfigurationError(
        'S3_ENDPOINT must use HTTPS in production.',
      );
    }
    endpoint = parsed.origin + parsed.pathname.replace(/\/$/, '');
  }

  const bucket = required(environment.S3_BUCKET, 'S3_BUCKET');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new StorageConfigurationError('S3_BUCKET is invalid.');
  }

  return {
    accessKeyId: required(environment.S3_ACCESS_KEY_ID, 'S3_ACCESS_KEY_ID'),
    bucket,
    endpoint,
    forcePathStyle: parseForcePathStyle(environment.S3_FORCE_PATH_STYLE),
    region: required(environment.S3_REGION, 'S3_REGION'),
    secretAccessKey: required(
      environment.S3_SECRET_ACCESS_KEY,
      'S3_SECRET_ACCESS_KEY',
    ),
  };
}

export function createS3Client(config = getStorageConfig()): S3Client {
  return new S3Client({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    region: config.region,
  });
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as {
    $metadata?: { httpStatusCode?: number };
    name?: string;
  };
  return (
    candidate.$metadata?.httpStatusCode === 404 ||
    candidate.name === 'NotFound' ||
    candidate.name === 'NoSuchKey'
  );
}

export function createS3UploadStorage(
  config = getStorageConfig(),
  client = createS3Client(config),
): UploadStorage {
  return {
    async createPresignedPutUrl({ contentType, expiresInSeconds, key }) {
      return getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: config.bucket,
          ContentType: contentType,
          Key: key,
        }),
        { expiresIn: expiresInSeconds },
      );
    },

    async headObject(key) {
      try {
        const object = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
        );
        return {
          contentLength: object.ContentLength,
          contentType: object.ContentType,
          key,
        };
      } catch (error) {
        if (isNotFound(error)) {
          throw new StorageObjectNotFoundError();
        }
        throw error;
      }
    },
  };
}
