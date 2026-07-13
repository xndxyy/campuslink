import { spawnSync } from 'node:child_process';

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
