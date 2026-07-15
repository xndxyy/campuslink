import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const requiredReleaseFiles = [
  'prisma/migrations/20260713220000_contract_legacy_content/migration.sql',
  'tests/e2e/authorization.spec.ts',
  'tests/e2e/moderation-ai.spec.ts',
] as const;

for (const path of requiredReleaseFiles) {
  if (!existsSync(path)) {
    console.error(`Required release evidence is missing: ${path}`);
    process.exit(1);
  }
}

const npmExecPath = process.env.npm_execpath;
if (!npmExecPath) {
  console.error('npm_execpath is required; run this script through npm.');
  process.exit(1);
}
const commands = [
  ['run', 'format:check'],
  ['run', 'db:generate'],
  ['run', 'lint'],
  ['run', 'typecheck'],
  ['run', 'test:unit'],
  ['run', 'db:migrate:deploy'],
  ['run', 'test:integration'],
  ['run', 'build'],
  ['run', 'e2e:provision'],
  ['run', 'test:e2e'],
] as const;

for (const args of commands) {
  const result = spawnSync(process.execPath, [npmExecPath, ...args], {
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
