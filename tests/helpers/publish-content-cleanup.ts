import { randomUUID } from 'node:crypto';

import type {
  PublishContentRunTags,
  RunScopedPublishTag,
} from './publish-content-run-tags';

export interface CleanupQueryResult {
  rowCount: number | null;
  rows: Array<Record<string, unknown>>;
}

export interface PublisherCleanupClient {
  query(sql: string, values?: unknown[]): Promise<CleanupQueryResult>;
  release(): Promise<void> | void;
}

export interface PublisherCleanupPool {
  connect(): Promise<PublisherCleanupClient>;
  end(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<CleanupQueryResult>;
}

export interface PublisherCleanupStorage {
  deleteObject(storageKey: string): Promise<void>;
  destroy(): Promise<void> | void;
}

export interface RunScopedPublisherCleanup {
  campusId: string;
  customTags: PublishContentRunTags;
  id: string;
}

const runScopedTags = (tags: PublishContentRunTags) => [
  tags.resource,
  tags.marketplace,
  tags.campusWork,
];

async function assertRunScopedTagJoinsRemoved(
  client: PublisherCleanupClient,
  campusId: string,
  tag: RunScopedPublishTag,
) {
  const joined = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM (
       SELECT resource_join."tagId"
       FROM "ResourceTag" AS resource_join
       INNER JOIN "TagDefinition" AS tag ON tag.id = resource_join."tagId"
       WHERE tag."campusId" = $1
         AND tag.scope = $2::"TagScope"
         AND tag.label = $3
         AND tag.slug = $4
       UNION ALL
       SELECT marketplace_join."tagId"
       FROM "MarketplaceTag" AS marketplace_join
       INNER JOIN "TagDefinition" AS tag ON tag.id = marketplace_join."tagId"
       WHERE tag."campusId" = $1
         AND tag.scope = $2::"TagScope"
         AND tag.label = $3
         AND tag.slug = $4
       UNION ALL
       SELECT work_join."tagId"
       FROM "CampusWorkTag" AS work_join
       INNER JOIN "TagDefinition" AS tag ON tag.id = work_join."tagId"
       WHERE tag."campusId" = $1
         AND tag.scope = $2::"TagScope"
         AND tag.label = $3
         AND tag.slug = $4
     ) AS scoped_joins`,
    [campusId, tag.scope, tag.label, tag.slug],
  );
  if (joined.rows[0]?.count !== 0) {
    throw new Error('Run-scoped tag joins remain after publisher cleanup.');
  }
}

export async function cleanupRunScopedPublisher(
  publisher: RunScopedPublisherCleanup,
  dependencies: {
    createId?: () => string;
    db: PublisherCleanupPool;
    storage: PublisherCleanupStorage;
  },
) {
  const { campusId, customTags, id: userId } = publisher;
  const { db, storage } = dependencies;
  const createId = dependencies.createId ?? randomUUID;
  const errors: unknown[] = [];
  const deletionJobs: Array<{ id: string; storageKey: string }> = [];
  let assets: Array<{ storageKey: string }> | null = null;
  let client: PublisherCleanupClient | null = null;
  let committed = false;

  try {
    try {
      const found = await db.query(
        `SELECT "storageKey" FROM "Asset" WHERE "ownerId" = $1`,
        [userId],
      );
      assets = found.rows.map((row) => ({
        storageKey: String(row.storageKey),
      }));
    } catch (error) {
      errors.push(error);
    }

    if (assets) {
      try {
        client = await db.connect();
      } catch (error) {
        errors.push(error);
      }
    }

    if (assets && client) {
      let transactionStarted = false;
      try {
        await client.query('BEGIN');
        transactionStarted = true;
        for (const { storageKey } of assets) {
          const queued = await client.query(
            `INSERT INTO "StorageDeletionJob" (id, "storageKey")
             VALUES ($1, $2)
             ON CONFLICT ("storageKey") DO UPDATE
             SET "storageKey" = EXCLUDED."storageKey"
             RETURNING id, "storageKey"`,
            [createId(), storageKey],
          );
          const job = queued.rows[0];
          if (!job) throw new Error('Storage deletion job was not queued.');
          deletionJobs.push({
            id: String(job.id),
            storageKey: String(job.storageKey),
          });
        }

        const deletedUser = await client.query(
          `DELETE FROM "User" WHERE id = $1`,
          [userId],
        );
        if (deletedUser.rowCount !== null && deletedUser.rowCount > 1) {
          throw new Error('Run-scoped publisher cleanup exceeded one user.');
        }
        for (const tag of runScopedTags(customTags)) {
          await assertRunScopedTagJoinsRemoved(client, campusId, tag);
          const deleted = await client.query(
            `DELETE FROM "TagDefinition"
             WHERE "campusId" = $1
               AND "isPreset" = false
               AND scope = $2::"TagScope"
               AND label = $3
               AND slug = $4
             RETURNING scope::text AS scope, label, slug`,
            [campusId, tag.scope, tag.label, tag.slug],
          );
          if (deleted.rowCount !== null && deleted.rowCount > 1) {
            throw new Error(
              'Run-scoped tag cleanup exceeded its exact target.',
            );
          }
          const returned = deleted.rows[0];
          if (
            returned &&
            (returned.scope !== tag.scope ||
              returned.label !== tag.label ||
              returned.slug !== tag.slug)
          ) {
            throw new Error(
              'Run-scoped tag cleanup returned an unexpected row.',
            );
          }
          await assertRunScopedTagJoinsRemoved(client, campusId, tag);
        }
        await client.query('COMMIT');
        transactionStarted = false;
        committed = true;
      } catch (error) {
        errors.push(error);
        if (transactionStarted) {
          try {
            await client.query('ROLLBACK');
          } catch (rollbackError) {
            errors.push(rollbackError);
          }
        }
      } finally {
        try {
          await client.release();
        } catch (error) {
          errors.push(error);
        }
      }
    }

    if (committed) {
      for (const job of deletionJobs) {
        try {
          await storage.deleteObject(job.storageKey);
        } catch (error) {
          errors.push(error);
          continue;
        }
        try {
          const deleted = await db.query(
            `DELETE FROM "StorageDeletionJob"
             WHERE id = $1 AND "storageKey" = $2`,
            [job.id, job.storageKey],
          );
          if (deleted.rowCount !== null && deleted.rowCount > 1) {
            throw new Error('Storage deletion cleanup exceeded one job.');
          }
        } catch (error) {
          errors.push(error);
        }
      }
    }
  } finally {
    try {
      await storage.destroy();
    } catch (error) {
      errors.push(error);
    }
    try {
      await db.end();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, 'Run-scoped publisher cleanup failed.');
  }
}

export type { RunScopedPublishTag };
