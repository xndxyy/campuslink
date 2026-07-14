-- pg_trgm is installed by 20260712183000_add_content_search_indexes.
-- CONCURRENTLY requires this migration to run without a transaction wrapper.
DROP INDEX CONCURRENTLY IF EXISTS "CampusWorkPost_title_trgm_idx";
CREATE INDEX CONCURRENTLY "CampusWorkPost_title_trgm_idx"
  ON "CampusWorkPost" USING GIN ("title" gin_trgm_ops);

DROP INDEX CONCURRENTLY IF EXISTS "CampusWorkPost_description_trgm_idx";
CREATE INDEX CONCURRENTLY "CampusWorkPost_description_trgm_idx"
  ON "CampusWorkPost" USING GIN ("description" gin_trgm_ops);

DROP INDEX CONCURRENTLY IF EXISTS "CampusWorkPost_location_trgm_idx";
CREATE INDEX CONCURRENTLY "CampusWorkPost_location_trgm_idx"
  ON "CampusWorkPost" USING GIN ("location" gin_trgm_ops);

DROP INDEX CONCURRENTLY IF EXISTS "CampusWorkPost_payText_trgm_idx";
CREATE INDEX CONCURRENTLY "CampusWorkPost_payText_trgm_idx"
  ON "CampusWorkPost" USING GIN ("payText" gin_trgm_ops);
