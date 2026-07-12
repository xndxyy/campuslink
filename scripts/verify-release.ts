import { spawnSync } from 'node:child_process';

const commands = [
  ['npm', ['run', 'format:check']],
  ['npm', ['run', 'lint']],
  ['npm', ['run', 'typecheck']],
  ['npm', ['run', 'test:unit']],
  ['npm', ['run', 'db:generate']],
  ['npm', ['run', 'db:migrate:deploy']],
  ['npm', ['run', 'test:integration']],
  ['npm', ['run', 'build']],
  ['npm', ['run', 'e2e:provision']],
  ['npm', ['run', 'test:e2e']],
] as const;

for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    env: process.env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
