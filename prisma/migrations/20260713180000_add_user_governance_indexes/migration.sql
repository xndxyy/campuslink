CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP INDEX CONCURRENTLY IF EXISTS "User_campus_createdAt_id_idx";
DROP INDEX CONCURRENTLY IF EXISTS "User_name_trgm_idx";
DROP INDEX CONCURRENTLY IF EXISTS "User_email_trgm_idx";

CREATE INDEX CONCURRENTLY "User_campus_createdAt_id_idx"
  ON "User" ("campusId", "createdAt" DESC, "id" DESC);

CREATE INDEX CONCURRENTLY "User_name_trgm_idx"
  ON "User" USING GIN ("name" gin_trgm_ops);

CREATE INDEX CONCURRENTLY "User_email_trgm_idx"
  ON "User" USING GIN ("email" gin_trgm_ops);
