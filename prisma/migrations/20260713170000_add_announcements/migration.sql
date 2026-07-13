ALTER TYPE "AssetKind" ADD VALUE IF NOT EXISTS 'ANNOUNCEMENT_IMAGE';
ALTER TYPE "ModerationSubjectType" ADD VALUE IF NOT EXISTS 'ANNOUNCEMENT';

CREATE TABLE "Announcement" (
  "id" TEXT NOT NULL,
  "campusId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "body" TEXT NOT NULL,
  "isPinned" BOOLEAN NOT NULL DEFAULT false,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StorageDeletionJob" (
  "id" TEXT NOT NULL,
  "storageKey" VARCHAR(512) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttempt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" VARCHAR(200),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StorageDeletionJob_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Asset"
  ADD COLUMN "announcementId" TEXT;

CREATE UNIQUE INDEX "Asset_announcementId_key"
  ON "Asset"("announcementId");

CREATE INDEX "Announcement_campusId_isPinned_publishedAt_id_idx"
  ON "Announcement"("campusId", "isPinned", "publishedAt", "id");

CREATE UNIQUE INDEX "StorageDeletionJob_storageKey_key"
  ON "StorageDeletionJob"("storageKey");

CREATE INDEX "StorageDeletionJob_nextAttempt_id_idx"
  ON "StorageDeletionJob"("nextAttempt", "id");

ALTER TABLE "Announcement"
  ADD CONSTRAINT "Announcement_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Announcement"
  ADD CONSTRAINT "Announcement_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_announcementId_fkey"
  FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
