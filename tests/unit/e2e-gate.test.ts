import { describe, expect, it } from 'vitest';
import { enforceE2eGate, requiredE2eEnvironment } from '@/tests/helpers/e2e-environment';

function complete() {
  return Object.fromEntries(requiredE2eEnvironment.map((name) => [name, 'configured']));
}

describe('E2E environment gate', () => {
  it('fails closed when real browser dependencies are absent', () => {
    expect(() => enforceE2eGate({})).toThrow('Missing E2E environment');
  });

  it('allows an explicit local skip but never a CI skip', () => {
    expect(enforceE2eGate({ ALLOW_SKIPPED_E2E: 'true' })).toBe(false);
    expect(() => enforceE2eGate({ ALLOW_SKIPPED_E2E: 'true', CI: 'true' })).toThrow('CI requires live E2E services');
  });

  it('runs when every real environment value is present', () => {
    expect(enforceE2eGate(complete())).toBe(true);
  });
});
