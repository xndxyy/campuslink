import { describe, expect, it } from 'vitest';

import { canCreateUploadIntent } from '@/lib/storage/upload-authorization';
import { uploadKinds } from '@/lib/validation/upload';

describe('upload-kind authorization', () => {
  it.each(['STUDENT', 'MODERATOR'] as const)(
    'denies ANNOUNCEMENT_IMAGE to %s',
    (role) => {
      expect(canCreateUploadIntent(role, 'ANNOUNCEMENT_IMAGE')).toBe(false);
    },
  );

  it('allows ANNOUNCEMENT_IMAGE only to administrators', () => {
    expect(canCreateUploadIntent('ADMIN', 'ANNOUNCEMENT_IMAGE')).toBe(true);
  });

  it.each(['STUDENT', 'MODERATOR', 'ADMIN'] as const)(
    'keeps every existing upload kind available to verified %s users',
    (role) => {
      const existingKinds = uploadKinds.filter(
        (kind) => kind !== 'ANNOUNCEMENT_IMAGE',
      );

      expect(existingKinds).toEqual([
        'RESOURCE_DOCUMENT',
        'RESOURCE_IMAGE',
        'MARKETPLACE_IMAGE',
      ]);
      expect(
        existingKinds.every((kind) => canCreateUploadIntent(role, kind)),
      ).toBe(true);
    },
  );
});
