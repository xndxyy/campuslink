import { describe, expect, it, vi } from 'vitest';
import { authorizeAssetRead, type ContentAdapter, ContentForbiddenError } from '@/lib/domain/content-service';

function db(asset: Record<string, unknown> | null) {
  return { asset: { findFirst: vi.fn(async () => asset), findMany: vi.fn(), updateMany: vi.fn() }, jobPost: {}, marketplaceItem: {}, resource: {} } as unknown as ContentAdapter;
}

const readyAsset = {
  contentType: 'application/pdf', id: 'asset_1', kind: 'RESOURCE_DOCUMENT', ownerId: 'owner_1',
  resource: { status: 'PUBLISHED' }, marketplaceItem: null, status: 'READY', storageKey: 'private/secret-key.pdf',
};

describe('asset read authorization', () => {
  it('allows anonymous reads only for READY assets on published parent content', async () => {
    await expect(authorizeAssetRead(db(readyAsset), null, 'asset_1')).resolves.toEqual({ contentType: 'application/pdf', kind: 'RESOURCE_DOCUMENT', storageKey: 'private/secret-key.pdf' });
    await expect(authorizeAssetRead(db({ ...readyAsset, resource: { status: 'PENDING' } }), null, 'asset_1')).rejects.toBeInstanceOf(ContentForbiddenError);
  });

  it('allows the owner and moderator to read nonpublic READY assets', async () => {
    const pending = db({ ...readyAsset, resource: { status: 'PENDING' } });
    await expect(authorizeAssetRead(pending, { campusId: 'campus_1', id: 'owner_1', role: 'STUDENT' }, 'asset_1')).resolves.toMatchObject({ storageKey: readyAsset.storageKey });
    await expect(authorizeAssetRead(pending, { campusId: 'campus_1', id: 'mod_1', role: 'MODERATOR' }, 'asset_1')).resolves.toMatchObject({ storageKey: readyAsset.storageKey });
  });

  it('denies a different student and non-ready assets', async () => {
    await expect(authorizeAssetRead(db({ ...readyAsset, resource: { status: 'PENDING' } }), { campusId: 'campus_1', id: 'other_1', role: 'STUDENT' }, 'asset_1')).rejects.toBeInstanceOf(ContentForbiddenError);
    await expect(authorizeAssetRead(db({ ...readyAsset, status: 'PENDING' }), { campusId: 'campus_1', id: 'owner_1', role: 'STUDENT' }, 'asset_1')).rejects.toBeInstanceOf(ContentForbiddenError);
  });
});
