import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { deployMigrations } from '../../scripts/migrate-deploy';

const scriptPath = fileURLToPath(
  new URL('../../scripts/migrate-deploy.ts', import.meta.url),
);
const packageJson = readFileSync(
  fileURLToPath(new URL('../../package.json', import.meta.url)),
  'utf8',
);

describe('migration deployment recovery', () => {
  it('routes production deploys through the guarded migration wrapper', () => {
    expect(existsSync(scriptPath)).toBe(true);
    const source = existsSync(scriptPath)
      ? readFileSync(scriptPath, 'utf8')
      : '';

    expect(packageJson).toContain(
      '"db:migrate:deploy": "tsx scripts/migrate-deploy.ts"',
    );
    expect(source).toContain('export async function deployMigrations');
    expect(source).toContain("import { Client } from 'pg'");
    expect(source).toMatch(/'prisma',\s*'build',\s*'index\.js'/);
    expect(source).toContain('FROM "_prisma_migrations"');
    expect(source).toContain('FROM pg_stat_progress_create_index');
    expect(source).toContain('createDefaultDependencies()');
  });

  it('recovers the three allowlisted concurrent-index migrations outside transactions', async () => {
    const migrations = [
      '20260713180000_add_user_governance_indexes',
      '20260713192000_add_tag_management_index',
      '20260713193000_add_campus_work_search_indexes',
    ];
    const failures = migrations.map((migrationName) => ({
      logs: 'Database error code: 25001: DROP INDEX CONCURRENTLY cannot run inside a transaction block',
      migrationName,
    }));
    const prismaCalls: string[][] = [];
    const statements: string[] = [];
    let deployAttempt = 0;
    let closed = false;

    await deployMigrations({
      close: async () => {
        closed = true;
      },
      executeStatement: async (statement: string) => {
        statements.push(statement);
      },
      findFailedMigration: async () => failures.shift() ?? null,
      hasActiveIndexBuilds: async () => false,
      readMigration: async (migrationName: string) =>
        readFileSync(
          fileURLToPath(
            new URL(
              `../../prisma/migrations/${migrationName}/migration.sql`,
              import.meta.url,
            ),
          ),
          'utf8',
        ),
      runPrisma: async (args: readonly string[]) => {
        prismaCalls.push([...args]);
        if (args[1] === 'deploy') {
          deployAttempt += 1;
          return deployAttempt <= migrations.length ? 1 : 0;
        }
        return 0;
      },
    });

    expect(prismaCalls).toEqual([
      ['migrate', 'deploy'],
      ['migrate', 'resolve', '--rolled-back', migrations[0]],
      ['migrate', 'resolve', '--applied', migrations[0]],
      ['migrate', 'deploy'],
      ['migrate', 'resolve', '--rolled-back', migrations[1]],
      ['migrate', 'resolve', '--applied', migrations[1]],
      ['migrate', 'deploy'],
      ['migrate', 'resolve', '--rolled-back', migrations[2]],
      ['migrate', 'resolve', '--applied', migrations[2]],
      ['migrate', 'deploy'],
    ]);
    expect(statements).toHaveLength(17);
    expect(statements.every((statement) => !/\bBEGIN\b/i.test(statement))).toBe(
      true,
    );
    expect(closed).toBe(true);
  });

  it('rejects modified allowlisted SQL before resolving or executing it', async () => {
    const migrationName = '20260713180000_add_user_governance_indexes';
    const prismaCalls: string[][] = [];
    const statements: string[] = [];
    let closed = false;

    await expect(
      deployMigrations({
        close: async () => {
          closed = true;
        },
        executeStatement: async (statement: string) => {
          statements.push(statement);
        },
        findFailedMigration: async () => ({
          logs: 'Database error code: 25001: CREATE INDEX CONCURRENTLY cannot run inside a transaction block',
          migrationName,
        }),
        hasActiveIndexBuilds: async () => false,
        readMigration: async () => 'DROP TABLE "User";',
        runPrisma: async (args: readonly string[]) => {
          prismaCalls.push([...args]);
          return args[1] === 'deploy' ? 1 : 0;
        },
      }),
    ).rejects.toThrow('checksum');

    expect(prismaCalls).toEqual([['migrate', 'deploy']]);
    expect(statements).toEqual([]);
    expect(closed).toBe(true);
  });
});
