BEGIN;

-- CreateEnum
CREATE TYPE "TagScope" AS ENUM ('RESOURCE', 'MARKETPLACE', 'CAMPUS_WORK');

-- CreateTable
CREATE TABLE "TagDefinition" (
  "id" TEXT NOT NULL,
  "campusId" TEXT NOT NULL,
  "scope" "TagScope" NOT NULL,
  "label" VARCHAR(32) NOT NULL,
  "slug" VARCHAR(40) NOT NULL,
  "isPreset" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TagDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampusWorkPost" (
  "id" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "campusId" TEXT NOT NULL,
  "company" VARCHAR(200),
  "title" VARCHAR(200) NOT NULL,
  "description" TEXT NOT NULL,
  "location" VARCHAR(200) NOT NULL,
  "payText" VARCHAR(200) NOT NULL,
  "contact" TEXT,
  "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CampusWorkPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceTag" (
  "resourceId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  "campusId" TEXT NOT NULL,
  "scope" "TagScope" NOT NULL DEFAULT 'RESOURCE',

  CONSTRAINT "ResourceTag_pkey" PRIMARY KEY ("resourceId", "tagId")
);

-- CreateTable
CREATE TABLE "MarketplaceTag" (
  "marketplaceItemId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  "campusId" TEXT NOT NULL,
  "scope" "TagScope" NOT NULL DEFAULT 'MARKETPLACE',

  CONSTRAINT "MarketplaceTag_pkey" PRIMARY KEY ("marketplaceItemId", "tagId")
);

-- CreateTable
CREATE TABLE "CampusWorkTag" (
  "campusWorkPostId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  "campusId" TEXT NOT NULL,
  "scope" "TagScope" NOT NULL DEFAULT 'CAMPUS_WORK',

  CONSTRAINT "CampusWorkTag_pkey" PRIMARY KEY ("campusWorkPostId", "tagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "TagDefinition_campusId_scope_slug_key"
  ON "TagDefinition"("campusId", "scope", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "TagDefinition_id_campusId_scope_key"
  ON "TagDefinition"("id", "campusId", "scope");

-- CreateIndex
CREATE INDEX "TagDefinition_campusId_scope_isActive_label_idx"
  ON "TagDefinition"("campusId", "scope", "isActive", "label");

-- CreateIndex
CREATE INDEX "CampusWorkPost_campusId_status_createdAt_id_idx"
  ON "CampusWorkPost"("campusId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CampusWorkPost_authorId_status_idx"
  ON "CampusWorkPost"("authorId", "status");

-- CreateIndex
CREATE INDEX "ResourceTag_tagId_resourceId_idx"
  ON "ResourceTag"("tagId", "resourceId");

-- CreateIndex
CREATE INDEX "MarketplaceTag_tagId_marketplaceItemId_idx"
  ON "MarketplaceTag"("tagId", "marketplaceItemId");

-- CreateIndex
CREATE INDEX "CampusWorkTag_tagId_campusWorkPostId_idx"
  ON "CampusWorkTag"("tagId", "campusWorkPostId");

-- AddForeignKey
ALTER TABLE "TagDefinition"
  ADD CONSTRAINT "TagDefinition_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampusWorkPost"
  ADD CONSTRAINT "CampusWorkPost_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampusWorkPost"
  ADD CONSTRAINT "CampusWorkPost_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceTag"
  ADD CONSTRAINT "ResourceTag_resourceId_fkey"
  FOREIGN KEY ("resourceId") REFERENCES "Resource"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceTag"
  ADD CONSTRAINT "ResourceTag_tagId_fkey"
  FOREIGN KEY ("tagId", "campusId", "scope")
  REFERENCES "TagDefinition"("id", "campusId", "scope")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceTag"
  ADD CONSTRAINT "MarketplaceTag_marketplaceItemId_fkey"
  FOREIGN KEY ("marketplaceItemId") REFERENCES "MarketplaceItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceTag"
  ADD CONSTRAINT "MarketplaceTag_tagId_fkey"
  FOREIGN KEY ("tagId", "campusId", "scope")
  REFERENCES "TagDefinition"("id", "campusId", "scope")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampusWorkTag"
  ADD CONSTRAINT "CampusWorkTag_campusWorkPostId_fkey"
  FOREIGN KEY ("campusWorkPostId") REFERENCES "CampusWorkPost"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampusWorkTag"
  ADD CONSTRAINT "CampusWorkTag_tagId_fkey"
  FOREIGN KEY ("tagId", "campusId", "scope")
  REFERENCES "TagDefinition"("id", "campusId", "scope")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce fixed content scopes in each explicit join.
ALTER TABLE "ResourceTag"
  ADD CONSTRAINT "ResourceTag_scope_check"
  CHECK ("scope" = 'RESOURCE'::"TagScope");

ALTER TABLE "MarketplaceTag"
  ADD CONSTRAINT "MarketplaceTag_scope_check"
  CHECK ("scope" = 'MARKETPLACE'::"TagScope");

ALTER TABLE "CampusWorkTag"
  ADD CONSTRAINT "CampusWorkTag_scope_check"
  CHECK ("scope" = 'CAMPUS_WORK'::"TagScope");

-- Validate that every join uses the campus of its content row. FOR SHARE
-- serializes this check with concurrent parent campus updates.
CREATE FUNCTION "_validate_tag_join_campus"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  content_id TEXT;
  parent_campus_id TEXT;
BEGIN
  content_id := to_jsonb(NEW) ->> TG_ARGV[1];

  EXECUTE format(
    'SELECT "campusId" FROM %I.%I WHERE "id" = $1 FOR SHARE',
    TG_TABLE_SCHEMA,
    TG_ARGV[0]
  )
  INTO parent_campus_id
  USING content_id;

  IF parent_campus_id IS NOT NULL
     AND NEW."campusId" IS DISTINCT FROM parent_campus_id THEN
    RAISE EXCEPTION
      'Tag join campus % does not match content campus %',
      NEW."campusId",
      parent_campus_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "ResourceTag_campus_guard"
BEFORE INSERT OR UPDATE ON "ResourceTag"
FOR EACH ROW
EXECUTE FUNCTION "_validate_tag_join_campus"('Resource', 'resourceId');

CREATE TRIGGER "MarketplaceTag_campus_guard"
BEFORE INSERT OR UPDATE ON "MarketplaceTag"
FOR EACH ROW
EXECUTE FUNCTION "_validate_tag_join_campus"('MarketplaceItem', 'marketplaceItemId');

CREATE TRIGGER "CampusWorkTag_campus_guard"
BEFORE INSERT OR UPDATE ON "CampusWorkTag"
FOR EACH ROW
EXECUTE FUNCTION "_validate_tag_join_campus"('CampusWorkPost', 'campusWorkPostId');

-- Once tags exist, changing a parent campus would invalidate the join.
-- Concurrent inserts wait on the parent row lock and revalidate afterward.
CREATE FUNCTION "_protect_tagged_content_campus"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  content_id TEXT;
  has_tags BOOLEAN;
BEGIN
  IF NEW."campusId" IS NOT DISTINCT FROM OLD."campusId" THEN
    RETURN NEW;
  END IF;

  content_id := to_jsonb(NEW) ->> 'id';
  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I = $1)',
    TG_TABLE_SCHEMA,
    TG_ARGV[0],
    TG_ARGV[1]
  )
  INTO has_tags
  USING content_id;

  IF has_tags THEN
    RAISE EXCEPTION
      'Cannot change campus for tagged % row %',
      TG_TABLE_NAME,
      content_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "Resource_tagged_campus_guard"
BEFORE UPDATE OF "campusId" ON "Resource"
FOR EACH ROW
EXECUTE FUNCTION "_protect_tagged_content_campus"('ResourceTag', 'resourceId');

CREATE TRIGGER "MarketplaceItem_tagged_campus_guard"
BEFORE UPDATE OF "campusId" ON "MarketplaceItem"
FOR EACH ROW
EXECUTE FUNCTION "_protect_tagged_content_campus"('MarketplaceTag', 'marketplaceItemId');

CREATE TRIGGER "CampusWorkPost_tagged_campus_guard"
BEFORE UPDATE OF "campusId" ON "CampusWorkPost"
FOR EACH ROW
EXECUTE FUNCTION "_protect_tagged_content_campus"('CampusWorkTag', 'campusWorkPostId');

-- Prevent a legacy write from crossing the backfill snapshot before the
-- synchronization trigger becomes visible at commit.
LOCK TABLE "JobPost" IN SHARE ROW EXCLUSIVE MODE;

CREATE FUNCTION "_sync_job_post_to_campus_work"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    EXECUTE format(
      'DELETE FROM %I.%I WHERE "id" = $1',
      TG_TABLE_SCHEMA,
      'CampusWorkPost'
    )
    USING OLD."id";
    RETURN OLD;
  END IF;

  EXECUTE format(
    $statement$
      INSERT INTO %I.%I (
        "id",
        "authorId",
        "campusId",
        "company",
        "title",
        "description",
        "location",
        "payText",
        "status",
        "createdAt",
        "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT ("id") DO UPDATE SET
        "authorId" = EXCLUDED."authorId",
        "campusId" = EXCLUDED."campusId",
        "company" = EXCLUDED."company",
        "title" = EXCLUDED."title",
        "description" = EXCLUDED."description",
        "location" = EXCLUDED."location",
        "payText" = EXCLUDED."payText",
        "status" = EXCLUDED."status",
        "createdAt" = EXCLUDED."createdAt",
        "updatedAt" = EXCLUDED."updatedAt"
    $statement$,
    TG_TABLE_SCHEMA,
    'CampusWorkPost'
  )
  USING
    NEW."id",
    NEW."authorId",
    NEW."campusId",
    NEW."company",
    NEW."title",
    NEW."description",
    NEW."location",
    NEW."payText",
    NEW."status",
    NEW."createdAt",
    NEW."updatedAt";

  RETURN NEW;
END
$$;

CREATE TRIGGER "JobPost_campus_work_sync"
AFTER INSERT OR UPDATE OR DELETE ON "JobPost"
FOR EACH ROW
EXECUTE FUNCTION "_sync_job_post_to_campus_work"();

-- Copy legacy jobs into the compatibility model without changing source data.
INSERT INTO "CampusWorkPost" (
  "id",
  "authorId",
  "campusId",
  "company",
  "title",
  "description",
  "location",
  "payText",
  "contact",
  "status",
  "createdAt",
  "updatedAt"
)
SELECT
  source."id",
  source."authorId",
  source."campusId",
  source."company",
  source."title",
  source."description",
  source."location",
  source."payText",
  NULL::TEXT,
  source."status",
  source."createdAt",
  source."updatedAt"
FROM "JobPost" AS source;

-- Abort the migration rather than accepting a partial or lossy copy.
DO $$
DECLARE
  source_count BIGINT;
  target_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO source_count FROM "JobPost";
  SELECT COUNT(*) INTO target_count FROM "CampusWorkPost";

  IF source_count <> target_count THEN
    RAISE EXCEPTION
      'CampusWorkPost row count mismatch: JobPost=%, CampusWorkPost=%',
      source_count,
      target_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "JobPost" AS source
    LEFT JOIN "CampusWorkPost" AS target ON target."id" = source."id"
    WHERE target."id" IS NULL
      OR target."authorId" IS DISTINCT FROM source."authorId"
      OR target."campusId" IS DISTINCT FROM source."campusId"
      OR target."company" IS DISTINCT FROM source."company"
      OR target."title" IS DISTINCT FROM source."title"
      OR target."description" IS DISTINCT FROM source."description"
      OR target."location" IS DISTINCT FROM source."location"
      OR target."payText" IS DISTINCT FROM source."payText"
      OR target."status" IS DISTINCT FROM source."status"
      OR target."createdAt" IS DISTINCT FROM source."createdAt"
      OR target."updatedAt" IS DISTINCT FROM source."updatedAt"
      OR target."contact" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'CampusWorkPost field mismatch after JobPost copy';
  END IF;
END
$$;

COMMIT;
