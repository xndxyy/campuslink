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

export function buildStorageKey(
  ownerId: string,
  assetId: string,
  canonicalExtension: string,
): string {
  if (!strictKeySegment.test(ownerId) || !strictKeySegment.test(assetId)) {
    throw new Error('Invalid storage key segment.');
  }

  if (!canonicalExtensions.has(canonicalExtension)) {
    throw new Error('Invalid canonical file extension.');
  }

  return `campus/${ownerId}/${assetId}.${canonicalExtension}`;
}
