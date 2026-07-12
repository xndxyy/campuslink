import { z } from 'zod';

export const MAX_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

export const uploadKinds = [
  'RESOURCE_DOCUMENT',
  'RESOURCE_IMAGE',
  'MARKETPLACE_IMAGE',
] as const;

export type UploadKind = (typeof uploadKinds)[number];

interface AllowedFileType {
  canonicalExtension: string;
  contentType: string;
}

const documentTypes: Readonly<Record<string, AllowedFileType>> = {
  docx: {
    canonicalExtension: 'docx',
    contentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  pdf: { canonicalExtension: 'pdf', contentType: 'application/pdf' },
  pptx: {
    canonicalExtension: 'pptx',
    contentType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  xlsx: {
    canonicalExtension: 'xlsx',
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  zip: { canonicalExtension: 'zip', contentType: 'application/zip' },
};

const imageTypes: Readonly<Record<string, AllowedFileType>> = {
  avif: { canonicalExtension: 'avif', contentType: 'image/avif' },
  jpeg: { canonicalExtension: 'jpg', contentType: 'image/jpeg' },
  jpg: { canonicalExtension: 'jpg', contentType: 'image/jpeg' },
  png: { canonicalExtension: 'png', contentType: 'image/png' },
  webp: { canonicalExtension: 'webp', contentType: 'image/webp' },
};

const policyByKind: Readonly<
  Record<UploadKind, { maxSizeBytes: number; types: typeof documentTypes }>
> = {
  MARKETPLACE_IMAGE: {
    maxSizeBytes: MAX_IMAGE_SIZE_BYTES,
    types: imageTypes,
  },
  RESOURCE_DOCUMENT: {
    maxSizeBytes: MAX_DOCUMENT_SIZE_BYTES,
    types: documentTypes,
  },
  RESOURCE_IMAGE: { maxSizeBytes: MAX_IMAGE_SIZE_BYTES, types: imageTypes },
};

const recognizedPriorExtensions = new Set([
  ...Object.keys(documentTypes),
  ...Object.keys(imageTypes),
  'apk',
  'app',
  'bat',
  'cmd',
  'com',
  'cjs',
  'dll',
  'dmg',
  'docm',
  'dotm',
  'exe',
  'htm',
  'html',
  'iso',
  'jar',
  'js',
  'mjs',
  'msi',
  'potm',
  'pps',
  'ppsm',
  'pptm',
  'ps1',
  'scr',
  'sh',
  'svg',
  'vbs',
  'xlsm',
  'xltm',
]);

export function normalizeContentType(contentType: string): string {
  return contentType.trim().toLowerCase();
}

export function normalizeUploadDisplayName(fileName: string): string {
  const baseName = fileName.normalize('NFKC').split(/[\\/]/).at(-1) ?? '';
  return baseName
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const rawUploadSchema = z.object({
  contentType: z.string().min(1).max(255),
  fileName: z.string().min(1).max(512),
  kind: z.enum(uploadKinds),
  sizeBytes: z.number().int().safe().positive(),
});

export const uploadIntentSchema = rawUploadSchema.transform(
  (input, context) => {
    const displayName = normalizeUploadDisplayName(input.fileName);
    const contentType = normalizeContentType(input.contentType);
    const parts = displayName.toLowerCase().split('.');
    const extension = parts.length > 1 ? parts.at(-1) : undefined;
    const policy = policyByKind[input.kind];
    const allowedType = extension ? policy.types[extension] : undefined;

    if (
      !displayName ||
      displayName.length > 255 ||
      !extension ||
      !allowedType
    ) {
      context.addIssue({
        code: 'custom',
        message: 'File type is not allowed for this upload.',
        path: ['fileName'],
      });
      return z.NEVER;
    }

    if (
      parts.slice(1, -1).some((part) => recognizedPriorExtensions.has(part))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Double file extensions are not allowed.',
        path: ['fileName'],
      });
    }

    if (contentType !== allowedType.contentType) {
      context.addIssue({
        code: 'custom',
        message: 'The file extension and content type do not match.',
        path: ['contentType'],
      });
    }

    if (input.sizeBytes > policy.maxSizeBytes) {
      context.addIssue({
        code: 'custom',
        message: 'File exceeds the maximum upload size.',
        path: ['sizeBytes'],
      });
    }

    return {
      canonicalExtension: allowedType.canonicalExtension,
      contentType: allowedType.contentType,
      displayName,
      kind: input.kind,
      sizeBytes: input.sizeBytes,
    };
  },
);

export function validateUpload(input: unknown) {
  return uploadIntentSchema.safeParse(input);
}

export const completeUploadSchema = z.object({
  assetId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
});
