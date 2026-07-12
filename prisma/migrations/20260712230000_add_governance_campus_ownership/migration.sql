ALTER TABLE "Report" ADD COLUMN "campusId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "campusId" TEXT;

UPDATE "Report" AS report
SET "campusId" = reporter."campusId"
FROM "User" AS reporter
WHERE report."reporterId" = reporter.id;

ALTER TABLE "Report" ALTER COLUMN "campusId" SET NOT NULL;

UPDATE "AuditLog" AS audit
SET "campusId" = actor."campusId"
FROM "User" AS actor
WHERE audit."actorId" = actor.id;

UPDATE "AuditLog" AS audit
SET "campusId" = campus.id
FROM "Campus" AS campus
WHERE audit."campusId" IS NULL
  AND audit."subjectType" = 'CAMPUS'
  AND audit."subjectId" = campus.id;

UPDATE "AuditLog" AS audit
SET "campusId" = subject."campusId"
FROM "User" AS subject
WHERE audit."campusId" IS NULL
  AND audit."subjectType" = 'USER'
  AND audit."subjectId" = subject.id;

UPDATE "AuditLog" AS audit
SET "campusId" = subject."campusId"
FROM "Resource" AS subject
WHERE audit."campusId" IS NULL
  AND audit."subjectType" = 'RESOURCE'
  AND audit."subjectId" = subject.id;

UPDATE "AuditLog" AS audit
SET "campusId" = subject."campusId"
FROM "MarketplaceItem" AS subject
WHERE audit."campusId" IS NULL
  AND audit."subjectType" = 'MARKETPLACE_ITEM'
  AND audit."subjectId" = subject.id;

UPDATE "AuditLog" AS audit
SET "campusId" = subject."campusId"
FROM "JobPost" AS subject
WHERE audit."campusId" IS NULL
  AND audit."subjectType" = 'JOB_POST'
  AND audit."subjectId" = subject.id;

UPDATE "AuditLog" AS audit
SET "campusId" = owner."campusId"
FROM "Asset" AS subject
JOIN "User" AS owner ON owner.id = subject."ownerId"
WHERE audit."campusId" IS NULL
  AND audit."subjectType" = 'ASSET'
  AND audit."subjectId" = subject.id;

UPDATE "AuditLog" AS audit
SET "campusId" = subject."campusId"
FROM "Report" AS subject
WHERE audit."campusId" IS NULL
  AND audit."subjectType" = 'REPORT'
  AND audit."subjectId" = subject.id;

CREATE TABLE "AuditLogQuarantine" (
  "originalId" TEXT NOT NULL,
  "actorId" TEXT,
  "event" VARCHAR(100) NOT NULL,
  "entityType" "ModerationSubjectType",
  "entityId" TEXT,
  "metadata" JSONB,
  "originalCreatedAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "quarantinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLogQuarantine_pkey" PRIMARY KEY ("originalId")
);

INSERT INTO "AuditLogQuarantine" (
  "originalId",
  "actorId",
  "event",
  "entityType",
  "entityId",
  "metadata",
  "originalCreatedAt",
  "reason"
)
SELECT
  audit.id,
  audit."actorId",
  audit.action,
  audit."subjectType",
  audit."subjectId",
  audit.details,
  audit."createdAt",
  'UNRESOLVED_CAMPUS_OWNERSHIP'
FROM "AuditLog" AS audit
WHERE audit."campusId" IS NULL;

DELETE FROM "AuditLog" AS audit
USING "AuditLogQuarantine" AS quarantine
WHERE audit.id = quarantine."originalId";

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
