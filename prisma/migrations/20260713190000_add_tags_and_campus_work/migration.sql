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

  CONSTRAINT "ResourceTag_pkey" PRIMARY KEY ("resourceId", "tagId")
);

-- CreateTable
CREATE TABLE "MarketplaceTag" (
  "marketplaceItemId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,

  CONSTRAINT "MarketplaceTag_pkey" PRIMARY KEY ("marketplaceItemId", "tagId")
);

-- CreateTable
CREATE TABLE "CampusWorkTag" (
  "campusWorkPostId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,

  CONSTRAINT "CampusWorkTag_pkey" PRIMARY KEY ("campusWorkPostId", "tagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "TagDefinition_campusId_scope_slug_key"
  ON "TagDefinition"("campusId", "scope", "slug");

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
  FOREIGN KEY ("tagId") REFERENCES "TagDefinition"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceTag"
  ADD CONSTRAINT "MarketplaceTag_marketplaceItemId_fkey"
  FOREIGN KEY ("marketplaceItemId") REFERENCES "MarketplaceItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceTag"
  ADD CONSTRAINT "MarketplaceTag_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "TagDefinition"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampusWorkTag"
  ADD CONSTRAINT "CampusWorkTag_campusWorkPostId_fkey"
  FOREIGN KEY ("campusWorkPostId") REFERENCES "CampusWorkPost"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampusWorkTag"
  ADD CONSTRAINT "CampusWorkTag_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "TagDefinition"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

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
