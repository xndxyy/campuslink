export const requiredIntegrationEnvironment = [
  'DATABASE_URL',
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_BUCKET',
  'S3_FORCE_PATH_STYLE',
] as const;

type IntegrationEnvironment = Record<string, string | undefined>;

export function hasCompleteIntegrationEnvironment(
  environment: IntegrationEnvironment,
): boolean {
  return requiredIntegrationEnvironment.every((name) =>
    Boolean(environment[name]?.trim()),
  );
}

export function enforceIntegrationGate(
  environment: IntegrationEnvironment,
): boolean {
  const missing = requiredIntegrationEnvironment.filter(
    (name) => !environment[name]?.trim(),
  );
  if (missing.length === 0) return true;

  const allowSkip = environment.ALLOW_SKIPPED_INTEGRATION === 'true';
  const inCi =
    environment.CI === 'true' ||
    environment.CI === '1' ||
    environment.CI === 'yes';
  if (allowSkip && !inCi) return false;
  if (allowSkip && inCi) {
    throw new Error(
      `CI requires live integration services. Missing: ${missing.join(', ')}`,
    );
  }
  throw new Error(`Missing integration environment: ${missing.join(', ')}`);
}
