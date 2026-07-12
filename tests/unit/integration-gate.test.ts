import { describe, expect, it } from 'vitest';

import { enforceIntegrationGate } from '@/tests/helpers/integration-environment';

const completeEnvironment = {
  DATABASE_URL: 'postgresql://localhost/campuslink',
  S3_ACCESS_KEY_ID: 'access',
  S3_BUCKET: 'campuslink',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_FORCE_PATH_STYLE: 'true',
  S3_REGION: 'us-east-1',
  S3_SECRET_ACCESS_KEY: 'secret',
};

describe('integration environment gate', () => {
  it('fails normally when database or storage configuration is missing', () => {
    expect(() => enforceIntegrationGate({})).toThrow(
      /Missing integration environment: DATABASE_URL, S3_ENDPOINT/,
    );
  });

  it('allows an explicit local skip outside CI', () => {
    expect(
      enforceIntegrationGate({ ALLOW_SKIPPED_INTEGRATION: 'true' }),
    ).toBe(false);
  });

  it('never permits the skip flag in CI', () => {
    expect(() =>
      enforceIntegrationGate({
        ALLOW_SKIPPED_INTEGRATION: 'true',
        CI: 'true',
      }),
    ).toThrow(/CI requires live integration services/);
  });

  it('runs when the complete integration environment is present', () => {
    expect(enforceIntegrationGate(completeEnvironment)).toBe(true);
  });
});
