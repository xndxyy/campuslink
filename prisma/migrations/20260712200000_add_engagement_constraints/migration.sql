CREATE TYPE "ReportReason" AS ENUM (
  'SPAM',
  'MISLEADING',
  'HARASSMENT',
  'PROHIBITED',
  'OTHER'
);

ALTER TABLE "Report" ADD COLUMN "reasonTyped" "ReportReason";

UPDATE "Report"
SET "reasonTyped" = CASE UPPER(TRIM("reason"))
  WHEN 'SPAM' THEN 'SPAM'::"ReportReason"
  WHEN 'MISLEADING' THEN 'MISLEADING'::"ReportReason"
  WHEN 'HARASSMENT' THEN 'HARASSMENT'::"ReportReason"
  WHEN 'PROHIBITED' THEN 'PROHIBITED'::"ReportReason"
  ELSE 'OTHER'::"ReportReason"
END;

ALTER TABLE "Report" ALTER COLUMN "reasonTyped" SET NOT NULL;
ALTER TABLE "Report" DROP COLUMN "reason";
ALTER TABLE "Report" RENAME COLUMN "reasonTyped" TO "reason";
