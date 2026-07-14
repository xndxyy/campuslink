DROP INDEX CONCURRENTLY IF EXISTS "TagDefinition_campusId_scope_label_id_idx";
CREATE INDEX CONCURRENTLY "TagDefinition_campusId_scope_label_id_idx" ON "TagDefinition"("campusId", "scope", "label", "id");
