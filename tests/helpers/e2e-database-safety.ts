import { assertSafeTestDatabase } from './database-safety';

type Environment = Record<string, string | undefined>;

export function assertSafeDestructiveE2eEnvironment(environment: Environment) {
  if (environment.ALLOW_DESTRUCTIVE_E2E !== 'true') {
    throw new Error('Destructive E2E requires ALLOW_DESTRUCTIVE_E2E=true.');
  }
  assertSafeTestDatabase(environment);
}
