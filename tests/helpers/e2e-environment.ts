import { requiredIntegrationEnvironment } from './integration-environment';

export const requiredE2eEnvironment = [
  ...requiredIntegrationEnvironment,
  'APP_URL',
  'E2E_VERIFIED_EMAIL',
  'E2E_VERIFIED_PASSWORD',
  'E2E_MODERATOR_EMAIL',
  'E2E_MODERATOR_PASSWORD',
  'E2E_ADMIN_EMAIL',
  'E2E_ADMIN_PASSWORD',
  'E2E_UNVERIFIED_EMAIL',
  'E2E_UNVERIFIED_PASSWORD',
  'E2E_REJECTED_KIND',
  'E2E_REJECTED_ID',
  'E2E_PUBLISHED_MARKETPLACE_ID',
] as const;

type Environment = Record<string, string | undefined>;

export function hasCompleteE2eEnvironment(environment: Environment) {
  return requiredE2eEnvironment.every((name) =>
    Boolean(environment[name]?.trim()),
  );
}

export function enforceE2eGate(environment: Environment) {
  const missing = requiredE2eEnvironment.filter(
    (name) => !environment[name]?.trim(),
  );
  if (missing.length === 0) return true;
  const allowSkip = environment.ALLOW_SKIPPED_E2E === 'true';
  const inCi = ['true', '1', 'yes'].includes(environment.CI ?? '');
  if (allowSkip && !inCi) return false;
  if (allowSkip && inCi)
    throw new Error(
      `CI requires live E2E services. Missing: ${missing.join(', ')}`,
    );
  throw new Error(`Missing E2E environment: ${missing.join(', ')}`);
}
