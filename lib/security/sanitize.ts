export function plainText(value: string, maxLength: number): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function safeDownloadFilename(value: string): string {
  const basename = value.normalize('NFKC').split(/[\\/]/).at(-1) ?? 'download';
  const cleaned = basename
    .replace(/[\u0000-\u001f\u007f";:]/g, '')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .trim()
    .slice(0, 180);
  return cleaned || 'download';
}
