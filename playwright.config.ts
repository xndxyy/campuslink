import { defineConfig, devices } from '@playwright/test';
import { enforceE2eGate } from './tests/helpers/e2e-environment';

const runE2e = enforceE2eGate(process.env);

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  webServer: runE2e
    ? {
        command: 'npm run dev',
        url: 'http://127.0.0.1:3000',
        reuseExistingServer: !process.env.CI,
      }
    : undefined,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
