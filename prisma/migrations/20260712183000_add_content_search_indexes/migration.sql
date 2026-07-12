CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Resource_title_trgm_idx"
  ON "Resource" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Resource_summary_trgm_idx"
  ON "Resource" USING GIN ("summary" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Resource_courseCode_trgm_idx"
  ON "Resource" USING GIN ("courseCode" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "MarketplaceItem_title_trgm_idx"
  ON "MarketplaceItem" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "MarketplaceItem_description_trgm_idx"
  ON "MarketplaceItem" USING GIN ("description" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "MarketplaceItem_pickupArea_trgm_idx"
  ON "MarketplaceItem" USING GIN ("pickupArea" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "JobPost_title_trgm_idx"
  ON "JobPost" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "JobPost_company_trgm_idx"
  ON "JobPost" USING GIN ("company" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "JobPost_description_trgm_idx"
  ON "JobPost" USING GIN ("description" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "JobPost_location_trgm_idx"
  ON "JobPost" USING GIN ("location" gin_trgm_ops);
