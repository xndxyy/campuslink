import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@/generated/prisma/client';

type DbClient = PrismaClient;

const globalForDb = globalThis as typeof globalThis & {
  campuslinkDb?: DbClient;
};

export function createDbClient(
  databaseUrl = process.env.DATABASE_URL,
): DbClient {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to create a database client');
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
}

export function getDb(): DbClient {
  if (!globalForDb.campuslinkDb) {
    globalForDb.campuslinkDb = createDbClient();
  }

  return globalForDb.campuslinkDb;
}
