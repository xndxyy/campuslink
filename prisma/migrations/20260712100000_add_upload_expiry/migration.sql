ALTER TABLE "Asset" ADD COLUMN "uploadExpiresAt" TIMESTAMP(3);

CREATE INDEX "Asset_status_uploadExpiresAt_idx"
ON "Asset"("status", "uploadExpiresAt");
