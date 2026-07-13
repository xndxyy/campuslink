const unsafeKey = /(?:password|token|secret|contact|session|credential)/i;
const unsafeEmailKey = /(?:^email$|emailAddress|oldEmail|newEmail)/i;

function isUnsafeKey(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return (
    unsafeKey.test(key) ||
    unsafeEmailKey.test(key) ||
    /(?:storage|object)key$/.test(normalized)
  );
}

export function sanitizeAuditDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuditDetails);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isUnsafeKey(key))
      .map(([key, nested]) => [key, sanitizeAuditDetails(nested)]),
  );
}
