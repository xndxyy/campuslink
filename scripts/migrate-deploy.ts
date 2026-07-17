import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Client } from 'pg';

type FailedMigration = {
  logs: string | null;
  migrationName: string;
};

export type MigrationDeployDependencies = {
  close: () => Promise<void>;
  executeStatement: (statement: string) => Promise<void>;
  findFailedMigration: () => Promise<FailedMigration | null>;
  hasActiveIndexBuilds: () => Promise<boolean>;
  readMigration: (migrationName: string) => Promise<string>;
  runPrisma: (args: readonly string[]) => Promise<number>;
};

const recoverableMigrations = new Map([
  [
    '20260713180000_add_user_governance_indexes',
    'cf0a947c004dc0db231b6446cd9171fa59be25d8a0167d1f0d2a04ff9236641b',
  ],
  [
    '20260713192000_add_tag_management_index',
    '8f54dcbe4a3dc6d40ee92d9136593126ebabdf2e7aeaa2d0cb9db5e4bc401d71',
  ],
  [
    '20260713193000_add_campus_work_search_indexes',
    'e5491ee2834a523db09617914fc5e8abf8216feceac3b80e08837ae31bc90b23',
  ],
]);

function migrationStatements(sql: string) {
  return sql
    .split(';')
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
}

function isTransactionBlockFailure(failure: FailedMigration) {
  return (
    failure.logs?.includes('25001') === true &&
    failure.logs.includes('transaction block')
  );
}

function verifyMigrationChecksum(migrationName: string, sql: string) {
  const expected = recoverableMigrations.get(migrationName);
  const normalized = sql.replace(/\r\n/g, '\n');
  const actual = createHash('sha256').update(normalized).digest('hex');

  if (!expected || actual !== expected) {
    throw new Error(`Recovery checksum mismatch for ${migrationName}`);
  }
}

function createDefaultDependencies(): MigrationDeployDependencies {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for migration deployment');
  }

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const prismaCli = resolve(
    root,
    'node_modules',
    'prisma',
    'build',
    'index.js',
  );
  const client = new Client({ connectionString: databaseUrl });
  let connected = false;

  const connect = async () => {
    if (connected) return;
    await client.connect();
    connected = true;
  };

  return {
    close: async () => {
      if (connected) await client.end();
    },
    executeStatement: async (statement) => {
      await connect();
      await client.query(statement);
    },
    findFailedMigration: async () => {
      await connect();
      const result = await client.query<{
        logs: string | null;
        migration_name: string;
      }>(`
        SELECT migration_name, logs
        FROM "_prisma_migrations"
        WHERE finished_at IS NULL
          AND rolled_back_at IS NULL
        ORDER BY started_at DESC
        LIMIT 1
      `);
      const failure = result.rows[0];
      return failure
        ? { logs: failure.logs, migrationName: failure.migration_name }
        : null;
    },
    hasActiveIndexBuilds: async () => {
      await connect();
      const result = await client.query<{ active: boolean }>(`
        SELECT EXISTS (
          SELECT 1
          FROM pg_stat_progress_create_index
          WHERE datname = current_database()
        ) AS active
      `);
      return result.rows[0]?.active === true;
    },
    readMigration: async (migrationName) =>
      readFile(
        resolve(root, 'prisma', 'migrations', migrationName, 'migration.sql'),
        'utf8',
      ),
    runPrisma: async (args) => {
      const result = spawnSync(process.execPath, [prismaCli, ...args], {
        cwd: root,
        env: process.env,
        stdio: 'inherit',
      });
      if (result.error) throw result.error;
      return result.status ?? 1;
    },
  };
}

export async function deployMigrations(
  dependencies?: MigrationDeployDependencies,
) {
  if (!dependencies) {
    throw new Error('Migration deploy dependencies are not configured');
  }

  const recovered = new Set<string>();

  try {
    while (true) {
      if ((await dependencies.runPrisma(['migrate', 'deploy'])) === 0) return;

      const failure = await dependencies.findFailedMigration();
      if (
        !failure ||
        !recoverableMigrations.has(failure.migrationName) ||
        !isTransactionBlockFailure(failure) ||
        recovered.has(failure.migrationName)
      ) {
        throw new Error('Prisma migrate deploy failed without safe recovery');
      }
      if (await dependencies.hasActiveIndexBuilds()) {
        throw new Error('Concurrent index creation is still active');
      }

      const migrationName = failure.migrationName;
      const sql = await dependencies.readMigration(migrationName);
      verifyMigrationChecksum(migrationName, sql);
      if (
        (await dependencies.runPrisma([
          'migrate',
          'resolve',
          '--rolled-back',
          migrationName,
        ])) !== 0
      ) {
        throw new Error(`Failed to mark ${migrationName} rolled back`);
      }

      for (const statement of migrationStatements(sql)) {
        await dependencies.executeStatement(statement);
      }

      if (
        (await dependencies.runPrisma([
          'migrate',
          'resolve',
          '--applied',
          migrationName,
        ])) !== 0
      ) {
        throw new Error(`Failed to mark ${migrationName} applied`);
      }
      recovered.add(migrationName);
    }
  } finally {
    await dependencies.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  deployMigrations(createDefaultDependencies()).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
