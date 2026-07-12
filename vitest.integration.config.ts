import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

import { enforceIntegrationGate } from './tests/helpers/integration-environment';

enforceIntegrationGate(process.env);

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      'server-only': fileURLToPath(
        new URL('./tests/helpers/server-only.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
  },
});
