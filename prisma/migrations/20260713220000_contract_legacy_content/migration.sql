BEGIN;

-- Contract only after all readers and writers use CampusWorkPost. The locks
-- keep the verification snapshot stable until the legacy objects are gone.
LOCK TABLE "JobPost", "CampusWorkPost", "Resource", "Campus"
  IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  legacy_count BIGINT;
  campus_work_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO legacy_count FROM "JobPost";
  SELECT COUNT(*) INTO campus_work_count
  FROM "CampusWorkPost" AS target
  INNER JOIN "JobPost" AS source ON source."id" = target."id";

  IF legacy_count <> campus_work_count THEN
    RAISE EXCEPTION
      'CampusWorkPost migrated row count mismatch: JobPost=%, matched CampusWorkPost=%',
      legacy_count,
      campus_work_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "JobPost" AS source
    LEFT JOIN "CampusWorkPost" AS target ON target."id" = source."id"
    WHERE target."id" IS NULL
      OR target."authorId" IS DISTINCT FROM source."authorId"
      OR target."campusId" IS DISTINCT FROM source."campusId"
      OR target."title" IS DISTINCT FROM source."title"
      OR target."description" IS DISTINCT FROM source."description"
      OR target."location" IS DISTINCT FROM source."location"
      OR target."payText" IS DISTINCT FROM source."payText"
      OR target."status" IS DISTINCT FROM source."status"
      OR target."createdAt" IS DISTINCT FROM source."createdAt"
      OR target."updatedAt" IS DISTINCT FROM source."updatedAt"
  ) THEN
    RAISE EXCEPTION 'CampusWorkPost field mismatch before JobPost contract';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CampusWorkPost"
    WHERE "authorId" IS NULL
      OR "campusId" IS NULL
      OR "title" IS NULL
      OR "description" IS NULL
      OR "location" IS NULL
      OR "payText" IS NULL
      OR "status" IS NULL
      OR "createdAt" IS NULL
      OR "updatedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'CampusWorkPost required field is null before contract';
  END IF;
END
$$;

DROP TRIGGER "JobPost_campus_work_sync" ON "JobPost";
DROP FUNCTION "_sync_job_post_to_campus_work"();
DROP TABLE "JobPost";

ALTER TABLE "Resource" DROP COLUMN "courseCode";
ALTER TABLE "Campus" DROP COLUMN "allowedEmailDomain";
ALTER TABLE "CampusWorkPost" DROP COLUMN "company";

COMMIT;
