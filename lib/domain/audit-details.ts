const unsafeKey = /(?:password|token|secret|contact|session|credential)/i;
const unsafeEmailKey = /(?:^email$|emailAddress|oldEmail|newEmail)/i;

export function sanitizeAuditDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuditDetails);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !unsafeKey.test(key) && !unsafeEmailKey.test(key))
      .map(([key, nested]) => [key, sanitizeAuditDetails(nested)]),
  );
}
