import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { assertSafeTestDatabase } from '@/tests/helpers/database-safety';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = describe.skipIf(!databaseUrl);
const migrationSql = readFileSync(
  fileURLToPath(
    new URL(
      '../../prisma/migrations/20260718100000_seed_forum_categories/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);
const temporarySchemaPattern = /^forum_category_defaults_[0-9a-f]{32}$/;

const minimalForumSchemaSql = `
CREATE TABLE "Campus" (
  "id" TEXT NOT NULL,
  CONSTRAINT "Campus_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ForumCategory" (
  "id" TEXT NOT NULL,
  "campusId" TEXT NOT NULL,
  "slug" VARCHAR(64) NOT NULL,
  "label" VARCHAR(100) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ForumCategory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ForumCategory_campusId_slug_key" UNIQUE ("campusId", "slug")
);
`;

describeWithDatabase('forum category defaults migration', () => {
  it('seeds every campus idempotently without changing administrator governance', async () => {
    assertSafeTestDatabase(process.env);
    if (!databaseUrl) {
      throw new Error('Migration harness requires DATABASE_URL.');
    }

    const temporarySchema = `forum_category_defaults_${randomUUID().replaceAll('-', '')}`;
    if (!temporarySchemaPattern.test(temporarySchema)) {
      throw new Error('Generated migration schema name is unsafe.');
    }

    const client = new Client({ connectionString: databaseUrl });
    let schemaCreated = false;

    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${temporarySchema}"`);
      schemaCreated = true;
      await client.query(`SET search_path TO "${temporarySchema}"`);
      await client.query(minimalForumSchemaSql);
      await client.query(`
        INSERT INTO "Campus" ("id")
        VALUES ('campus-a'), ('campus-b');

        INSERT INTO "ForumCategory" (
          "id",
          "campusId",
          "slug",
          "label",
          "isActive",
          "createdAt",
          "updatedAt"
        )
        VALUES (
          'administrator-category',
          'campus-a',
          'campus-life',
          '管理员命名',
          false,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        );
      `);

      await client.query(migrationSql);
      await client.query(migrationSql);

      const counts = await client.query(`
        SELECT "campusId", COUNT(*)::int AS count
        FROM "ForumCategory"
        GROUP BY "campusId"
        ORDER BY "campusId"
      `);
      expect(counts.rows).toStrictEqual([
        { campusId: 'campus-a', count: 7 },
        { campusId: 'campus-b', count: 7 },
      ]);

      const administratorCategory = await client.query(`
        SELECT "label", "isActive"
        FROM "ForumCategory"
        WHERE "campusId" = 'campus-a'
          AND "slug" = 'campus-life'
      `);
      expect(administratorCategory.rows).toStrictEqual([
        { isActive: false, label: '管理员命名' },
      ]);
    } finally {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Continue cleanup if the session is already outside a transaction.
      }
      try {
        if (schemaCreated) {
          await client.query('RESET search_path');
          await client.query(`DROP SCHEMA "${temporarySchema}" CASCADE`);
        }
      } finally {
        await client.end();
      }
    }
  });
});
