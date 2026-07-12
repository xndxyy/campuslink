import { describe, expect, it, vi } from 'vitest';
import {
  authorizeAssetRead,
  type ContentAdapter,
  ContentAuthenticationRequiredError,
  ContentForbiddenError,
} from '@/lib/domain/content-service';

function db(asset: Record<string, unknown> | null) {
  return {
    asset: {
      findFirst: vi.fn(async () => asset),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    jobPost: {},
    marketplaceItem: {},
    resource: {},
  } as unknown as ContentAdapter;
}

const readyAsset = {
  contentType: 'application/pdf',
  id: 'asset_1',
  kind: 'RESOURCE_DOCUMENT',
  ownerId: 'owner_1',
  resource: { status: 'PUBLISHED' },
  marketplaceItem: null,
  status: 'READY',
  storageKey: 'private/secret-key.pdf',
};

describe('asset read authorization', () => {
  it('requires a verified actor for published resource documents', async () => {
    await expect(
      authorizeAssetRead(db(readyAsset), null, 'asset_1'),
    ).rejects.toBeInstanceOf(ContentAuthenticationRequiredError);
    await expect(
      authorizeAssetRead(
        db(readyAsset),
        { campusId: 'campus_1', id: 'student_2', role: 'STUDENT' },
        'asset_1',
      ),
    ).resolves.toMatchObject({ kind: 'RESOURCE_DOCUMENT' });
  });

  it('allows anonymous reads only for published display images', async () => {
    await expect(
      authorizeAssetRead(
        db({ ...readyAsset, contentType: 'image/png', kind: 'RESOURCE_IMAGE' }),
        null,
        'asset_1',
      ),
    ).resolves.toMatchObject({ kind: 'RESOURCE_IMAGE' });
    await expect(
      authorizeAssetRead(
        db({
          ...readyAsset,
          contentType: 'image/png',
          kind: 'RESOURCE_IMAGE',
          resource: { status: 'PENDING' },
        }),
        null,
        'asset_1',
      ),
    ).rejects.toBeInstanceOf(ContentAuthenticationRequiredError);
  });

  it('allows the owner and moderator to read nonpublic READY assets', async () => {
    const pending = db({ ...readyAsset, resource: { status: 'PENDING' } });
    await expect(
      authorizeAssetRead(
        pending,
        { campusId: 'campus_1', id: 'owner_1', role: 'STUDENT' },
        'asset_1',
      ),
    ).resolves.toMatchObject({ storageKey: readyAsset.storageKey });
    await expect(
      authorizeAssetRead(
        pending,
        { campusId: 'campus_1', id: 'mod_1', role: 'MODERATOR' },
        'asset_1',
      ),
    ).resolves.toMatchObject({ storageKey: readyAsset.storageKey });
  });

  it('denies a different student and non-ready assets', async () => {
    await expect(
      authorizeAssetRead(
        db({ ...readyAsset, resource: { status: 'PENDING' } }),
        { campusId: 'campus_1', id: 'other_1', role: 'STUDENT' },
        'asset_1',
      ),
    ).rejects.toBeInstanceOf(ContentForbiddenError);
    await expect(
      authorizeAssetRead(
        db({ ...readyAsset, status: 'PENDING' }),
        { campusId: 'campus_1', id: 'owner_1', role: 'STUDENT' },
        'asset_1',
      ),
    ).rejects.toBeInstanceOf(ContentForbiddenError);
  });
});
