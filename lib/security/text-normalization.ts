const separators = /[\s\-‐‑‒–—―_./\\|,，。、:：;；]+/gu;
const regexSyntax = /[\[\]{}()*+?^$\\]/u;

export function normalizeModerationText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(separators, '');
}

export function normalizePlainTextBlockedWord(value: string) {
  if (
    typeof value !== 'string' ||
    value.length > 200 ||
    regexSyntax.test(value)
  ) {
    throw new Error('Invalid blocked word');
  }
  const original = value.trim();
  const normalized = normalizeModerationText(original);
  if (!original || !normalized || /[\p{C}]/u.test(original)) {
    throw new Error('Invalid blocked word');
  }
  return { normalized, original };
}
