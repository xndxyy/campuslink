type Environment = Record<string, string | undefined>;

export function assertSafeTestDatabase(environment: Environment) {
  if (environment.NODE_ENV === 'production') {
    throw new Error('Test database access is forbidden in production.');
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(environment.DATABASE_URL ?? '');
  } catch {
    throw new Error('Test database access requires a valid DATABASE_URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('Test database access requires a PostgreSQL DATABASE_URL.');
  }
  const databaseName = decodeURIComponent(
    databaseUrl.pathname.split('/').filter(Boolean).at(-1) ?? '',
  );
  if (!/(?:_e2e|_test)$/.test(databaseName)) {
    throw new Error('Test database name must end in _e2e or _test.');
  }
}
