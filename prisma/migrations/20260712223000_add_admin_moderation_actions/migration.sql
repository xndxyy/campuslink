ALTER TYPE "ModerationSubjectType" ADD VALUE IF NOT EXISTS 'CAMPUS';
ALTER TYPE "ModerationSubjectType" ADD VALUE IF NOT EXISTS 'REPORT';

ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'ARCHIVE';
ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'TRIAGE';
ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'DISMISS';
ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'RESOLVE';

ALTER TABLE "Report" ADD COLUMN "campusId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "campusId" TEXT;

UPDATE "Report" AS report
SET "campusId" = reporter."campusId"
FROM "User" AS reporter
WHERE report."reporterId" = reporter.id;

UPDATE "AuditLog" AS audit
SET "campusId" = actor."campusId"
FROM "User" AS actor
WHERE audit."actorId" = actor.id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Report" WHERE "campusId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot backfill Report campus ownership from reporter';
  END IF;
  IF EXISTS (SELECT 1 FROM "AuditLog" WHERE "campusId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot backfill actorless AuditLog campus ownership';
  END IF;
END
$$;

ALTER TABLE "Report" ALTER COLUMN "campusId" SET NOT NULL;
ALTER TABLE "AuditLog" ALTER COLUMN "campusId" SET NOT NULL;

CREATE INDEX "Report_campusId_status_createdAt_id_idx"
ON "Report"("campusId", "status", "createdAt", "id");
CREATE INDEX "AuditLog_campusId_createdAt_id_idx"
ON "AuditLog"("campusId", "createdAt", "id");

ALTER TABLE "Report" ADD CONSTRAINT "Report_campusId_fkey"
FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_campusId_fkey"
FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_governance_campus_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."campusId" IS DISTINCT FROM OLD."campusId" THEN
    RAISE EXCEPTION 'Governance campus ownership is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Report_immutable_campusId"
BEFORE UPDATE ON "Report"
FOR EACH ROW EXECUTE FUNCTION prevent_governance_campus_change();

CREATE TRIGGER "AuditLog_immutable_campusId"
BEFORE UPDATE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION prevent_governance_campus_change();
