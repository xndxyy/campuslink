BEGIN;

ALTER TABLE "Resource"
  ADD COLUMN "ownerDeletionRequestedAt" TIMESTAMP(3);

ALTER TABLE "MarketplaceItem"
  ADD COLUMN "ownerDeletionRequestedAt" TIMESTAMP(3);

ALTER TABLE "CampusWorkPost"
  ADD COLUMN "ownerDeletionRequestedAt" TIMESTAMP(3);

ALTER TABLE "ForumPost"
  ADD COLUMN "ownerDeletionRequestedAt" TIMESTAMP(3);

CREATE INDEX "Resource_owner_delete_idx"
  ON "Resource"("campusId", "authorId", "ownerDeletionRequestedAt", "createdAt", "id");

CREATE INDEX "MarketplaceItem_owner_delete_idx"
  ON "MarketplaceItem"("campusId", "sellerId", "ownerDeletionRequestedAt", "createdAt", "id");

CREATE INDEX "CampusWorkPost_owner_delete_idx"
  ON "CampusWorkPost"("campusId", "authorId", "ownerDeletionRequestedAt", "createdAt", "id");

CREATE INDEX "ForumPost_author_owner_delete_idx"
  ON "ForumPost"("campusId", "authorId", "ownerDeletionRequestedAt", "createdAt", "id");

CREATE INDEX "ForumPost_anon_owner_delete_idx"
  ON "ForumPost"("campusId", "anonymousFingerprint", "ownerDeletionRequestedAt", "createdAt", "id");

COMMIT;
