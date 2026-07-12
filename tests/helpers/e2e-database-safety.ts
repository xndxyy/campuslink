type Environment = Record<string, string | undefined>;

export function assertSafeDestructiveE2eEnvironment(environment: Environment) {
  if (environment.ALLOW_DESTRUCTIVE_E2E !== 'true') {
    throw new Error('Destructive E2E requires ALLOW_DESTRUCTIVE_E2E=true.');
  }
  if (environment.NODE_ENV === 'production') {
    throw new Error('Destructive E2E is forbidden in production.');
  }
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(environment.DATABASE_URL ?? '');
  } catch {
    throw new Error('Destructive E2E requires a valid DATABASE_URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('Destructive E2E requires a PostgreSQL DATABASE_URL.');
  }
  const databaseName = decodeURIComponent(
    databaseUrl.pathname.split('/').filter(Boolean).at(-1) ?? '',
  );
  if (!/(?:_e2e|_test)$/.test(databaseName)) {
    throw new Error('Destructive E2E database must end in _e2e or _test.');
  }
}
