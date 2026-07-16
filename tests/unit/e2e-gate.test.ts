import { describe, expect, it } from 'vitest';
import {
  enforceE2eGate,
  requiredE2eEnvironment,
} from '@/tests/helpers/e2e-environment';
import * as e2eEnvironment from '@/tests/helpers/e2e-environment';

function complete() {
  return Object.fromEntries(
    requiredE2eEnvironment.map((name) => [name, 'configured']),
  );
}

describe('E2E environment gate', () => {
  it('fails closed when real browser dependencies are absent', () => {
    expect(() => enforceE2eGate({})).toThrow('Missing E2E environment');
  });

  it('allows an explicit local skip but never a CI skip', () => {
    expect(enforceE2eGate({ ALLOW_SKIPPED_E2E: 'true' })).toBe(false);
    expect(() =>
      enforceE2eGate({ ALLOW_SKIPPED_E2E: 'true', CI: 'true' }),
    ).toThrow('CI requires live E2E services');
  });

  it('runs when every real environment value is present', () => {
    expect(requiredE2eEnvironment).toContain('APP_URL');
    expect(requiredE2eEnvironment).not.toContain(
      'E2E_PUBLISHED_MARKETPLACE_ID',
    );
    expect(enforceE2eGate(complete())).toBe(true);
  });

  it('lets infrastructure-only governance run while shared fixtures stay fail-closed in CI', () => {
    const shouldRunSharedAccountE2e = (
      e2eEnvironment as unknown as {
        shouldRunSharedAccountE2e?: (
          environment: Record<string, string | undefined>,
        ) => boolean;
      }
    ).shouldRunSharedAccountE2e;
    expect(typeof shouldRunSharedAccountE2e).toBe('function');
    if (!shouldRunSharedAccountE2e) return;
    expect(shouldRunSharedAccountE2e(complete())).toBe(false);
    expect(() =>
      shouldRunSharedAccountE2e({ ...complete(), CI: 'true' }),
    ).toThrow('CI requires shared-account E2E fixtures');
  });

  it('requires AI administration keys for the publishing-governance workflow', () => {
    const shouldRunPublishingGovernanceE2e = (
      e2eEnvironment as unknown as {
        shouldRunPublishingGovernanceE2e?: (
          environment: Record<string, string | undefined>,
        ) => boolean;
      }
    ).shouldRunPublishingGovernanceE2e;
    expect(typeof shouldRunPublishingGovernanceE2e).toBe('function');
    if (!shouldRunPublishingGovernanceE2e) return;
    expect(shouldRunPublishingGovernanceE2e(complete())).toBe(false);
    expect(() =>
      shouldRunPublishingGovernanceE2e({ ...complete(), CI: 'true' }),
    ).toThrow('CI requires publishing-governance E2E fixtures');
    expect(
      shouldRunPublishingGovernanceE2e({
        ...complete(),
        AI_ALLOWED_HOSTS: 'api.openai.com',
        AI_CONFIG_ENCRYPTION_KEY_V1:
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      }),
    ).toBe(true);
  });
});
