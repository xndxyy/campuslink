ALTER TYPE "AssetStatus" ADD VALUE 'CLEANING';

ALTER TABLE "Asset" ADD COLUMN "uploadExpiresAt" TIMESTAMP(3);

UPDATE "Asset"
SET "uploadExpiresAt" = "createdAt" + INTERVAL '5 minutes'
WHERE "status" IN ('PENDING', 'REJECTED')
  AND "uploadExpiresAt" IS NULL;

CREATE INDEX "Asset_status_uploadExpiresAt_idx"
ON "Asset"("status", "uploadExpiresAt");
