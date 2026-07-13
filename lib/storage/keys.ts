const strictKeySegment = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const canonicalExtensions = new Set([
  'avif',
  'docx',
  'jpg',
  'pdf',
  'png',
  'pptx',
  'webp',
  'xlsx',
  'zip',
]);

export const storageNamespaceByKind = {
  ANNOUNCEMENT_IMAGE: 'announcements',
  MARKETPLACE_IMAGE: 'campus',
  RESOURCE_DOCUMENT: 'campus',
  RESOURCE_IMAGE: 'campus',
} as const;

export type StorageKeyKind = keyof typeof storageNamespaceByKind;

export function buildStorageKey(
  ownerId: string,
  assetId: string,
  canonicalExtension: string,
  kind: StorageKeyKind,
): string {
  if (!strictKeySegment.test(ownerId) || !strictKeySegment.test(assetId)) {
    throw new Error('Invalid storage key segment.');
  }

  if (!canonicalExtensions.has(canonicalExtension)) {
    throw new Error('Invalid canonical file extension.');
  }

  if (!Object.hasOwn(storageNamespaceByKind, kind)) {
    throw new Error('Invalid storage key kind.');
  }

  const namespace = storageNamespaceByKind[kind];
  return `${namespace}/${ownerId}/${assetId}.${canonicalExtension}`;
}
