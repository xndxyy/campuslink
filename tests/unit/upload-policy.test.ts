import { describe, expect, it } from 'vitest';

import {
  MAX_DOCUMENT_SIZE_BYTES,
  MAX_IMAGE_SIZE_BYTES,
  validateUpload,
} from '@/lib/validation/upload';

describe('upload policy', () => {
  it.each([
    {
      contentType: 'application/pdf',
      expectedExtension: 'pdf',
      fileName: 'lecture-notes.pdf',
      kind: 'RESOURCE_DOCUMENT' as const,
    },
    {
      contentType: 'image/jpeg',
      expectedExtension: 'jpg',
      fileName: 'desk-photo.jpeg',
      kind: 'MARKETPLACE_IMAGE' as const,
    },
    {
      contentType: 'image/avif',
      expectedExtension: 'avif',
      fileName: 'diagram.avif',
      kind: 'RESOURCE_IMAGE' as const,
    },
  ])(
    'accepts $fileName for $kind and returns a canonical extension',
    ({ contentType, expectedExtension, fileName, kind }) => {
      const result = validateUpload({
        contentType,
        fileName,
        kind,
        sizeBytes: 1_024,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.canonicalExtension).toBe(expectedExtension);
      }
    },
  );

  it.each([
    ['notes.pdf', 'application/zip', 'RESOURCE_DOCUMENT'],
    ['notes.pdf.zip', 'application/zip', 'RESOURCE_DOCUMENT'],
    ['archive.backup.zip', 'application/zip', 'RESOURCE_DOCUMENT'],
    ['photo.backup.jpg', 'image/jpeg', 'MARKETPLACE_IMAGE'],
    ['notes.tar.pdf', 'application/pdf', 'RESOURCE_DOCUMENT'],
    ['photo.png', 'image/jpeg', 'MARKETPLACE_IMAGE'],
  ] as const)(
    'rejects a mismatched or double extension: %s',
    (fileName, contentType, kind) => {
      expect(
        validateUpload({ contentType, fileName, kind, sizeBytes: 1_024 })
          .success,
      ).toBe(false);
    },
  );

  it.each(['.pdf', '   .pdf   '])(
    'rejects a hidden or empty-base filename: %s',
    (fileName) => {
      expect(
        validateUpload({
          contentType: 'application/pdf',
          fileName,
          kind: 'RESOURCE_DOCUMENT',
          sizeBytes: 1_024,
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    ['vector.svg', 'image/svg+xml', 'RESOURCE_IMAGE'],
    ['payload.html', 'text/html', 'RESOURCE_DOCUMENT'],
    [
      'macro.docm',
      'application/vnd.ms-word.document.macroEnabled.12',
      'RESOURCE_DOCUMENT',
    ],
    [
      'installer.exe',
      'application/vnd.microsoft.portable-executable',
      'RESOURCE_DOCUMENT',
    ],
  ] as const)('rejects unsafe file %s', (fileName, contentType, kind) => {
    expect(
      validateUpload({ contentType, fileName, kind, sizeBytes: 1_024 }).success,
    ).toBe(false);
  });

  it.each([
    ['zero bytes', 0, 'RESOURCE_DOCUMENT', 'empty.pdf', 'application/pdf'],
    ['negative bytes', -1, 'RESOURCE_DOCUMENT', 'bad.pdf', 'application/pdf'],
    [
      'oversize document',
      MAX_DOCUMENT_SIZE_BYTES + 1,
      'RESOURCE_DOCUMENT',
      'large.pdf',
      'application/pdf',
    ],
    [
      'oversize image',
      MAX_IMAGE_SIZE_BYTES + 1,
      'MARKETPLACE_IMAGE',
      'large.png',
      'image/png',
    ],
  ] as const)(
    'rejects %s',
    (_caseName, sizeBytes, kind, fileName, contentType) => {
      expect(
        validateUpload({ contentType, fileName, kind, sizeBytes }).success,
      ).toBe(false);
    },
  );

  it('normalizes a user filename only for safe display', () => {
    const result = validateUpload({
      contentType: 'application/pdf',
      fileName: '../  lecture\u0000 notes.pdf  ',
      kind: 'RESOURCE_DOCUMENT',
      sizeBytes: 1_024,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBe('lecture notes.pdf');
    }
  });
});
