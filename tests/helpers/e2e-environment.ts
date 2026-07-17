import { requiredIntegrationEnvironment } from './integration-environment';

export const requiredE2eEnvironment = [
  ...requiredIntegrationEnvironment,
  'APP_URL',
] as const;

export const requiredSharedAccountE2eEnvironment = [
  ...requiredE2eEnvironment,
  'E2E_VERIFIED_EMAIL',
  'E2E_VERIFIED_PASSWORD',
  'E2E_UNVERIFIED_EMAIL',
  'E2E_UNVERIFIED_PASSWORD',
  'E2E_OTHER_EMAIL',
  'E2E_OTHER_PASSWORD',
  'E2E_REJECTED_KIND',
  'E2E_REJECTED_ID',
  'E2E_PUBLISHED_MARKETPLACE_ID',
] as const;

export const requiredAiModerationE2eEnvironment = [
  ...requiredE2eEnvironment,
  'AI_CONFIG_ENCRYPTION_KEY_V1',
  'AI_ALLOWED_HOSTS',
  'E2E_AI_BASE_URL',
  'E2E_AI_FAILURE_BASE_URL',
  'E2E_AI_API_KEY',
  'E2E_AI_MODEL',
] as const;

export const requiredPublishingGovernanceE2eEnvironment = [
  ...requiredE2eEnvironment,
  'AI_CONFIG_ENCRYPTION_KEY_V1',
  'AI_ALLOWED_HOSTS',
  'ANONYMOUS_IDENTITY_KEY_V1',
  'ANONYMOUS_FINGERPRINT_KEY',
] as const;

type Environment = Record<string, string | undefined>;

export function hasCompleteE2eEnvironment(environment: Environment) {
  return requiredSharedAccountE2eEnvironment.every((name) =>
    Boolean(environment[name]?.trim()),
  );
}

export function hasCompleteGovernanceE2eEnvironment(environment: Environment) {
  return requiredE2eEnvironment.every((name) =>
    Boolean(environment[name]?.trim()),
  );
}

export function hasCompleteAiModerationE2eEnvironment(
  environment: Environment,
) {
  return requiredAiModerationE2eEnvironment.every((name) =>
    Boolean(environment[name]?.trim()),
  );
}

export function shouldRunSharedAccountE2e(environment: Environment) {
  const missing = requiredSharedAccountE2eEnvironment.filter(
    (name) => !environment[name]?.trim(),
  );
  if (missing.length === 0) return true;
  const inCi = ['true', '1', 'yes'].includes(environment.CI ?? '');
  if (inCi) {
    throw new Error(
      `CI requires shared-account E2E fixtures. Missing: ${missing.join(', ')}`,
    );
  }
  return false;
}

export function shouldRunPublishingGovernanceE2e(environment: Environment) {
  const missing = requiredPublishingGovernanceE2eEnvironment.filter(
    (name) => !environment[name]?.trim(),
  );
  if (missing.length === 0) return true;
  const inCi = ['true', '1', 'yes'].includes(environment.CI ?? '');
  if (inCi) {
    throw new Error(
      `CI requires publishing-governance E2E fixtures. Missing: ${missing.join(', ')}`,
    );
  }
  return false;
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
