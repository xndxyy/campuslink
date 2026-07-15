BEGIN;

CREATE TYPE "ContentAssessmentTarget" AS ENUM (
  'RESOURCE',
  'MARKETPLACE_ITEM',
  'CAMPUS_WORK',
  'FORUM_POST',
  'FORUM_COMMENT',
  'CUSTOM_TAG'
);

CREATE TYPE "ContentAssessmentDecision" AS ENUM (
  'PASS',
  'REVIEW',
  'BLOCK'
);

CREATE TYPE "ProviderExecutionStatus" AS ENUM (
  'COMPLETED',
  'SKIPPED'
);

CREATE TABLE "BlockedWord" (
  "id" TEXT NOT NULL,
  "campusId" TEXT NOT NULL,
  "original" VARCHAR(200) NOT NULL,
  "normalized" VARCHAR(200) NOT NULL,
  "category" VARCHAR(100) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BlockedWord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BlockedWord_original_nonempty_check"
    CHECK (char_length(btrim("original")) > 0),
  CONSTRAINT "BlockedWord_normalized_nonempty_check"
    CHECK (char_length(btrim("normalized")) > 0),
  CONSTRAINT "BlockedWord_category_nonempty_check"
    CHECK (char_length(btrim("category")) > 0),
  CONSTRAINT "BlockedWord_reason_nonempty_check"
    CHECK (char_length(btrim("reason")) > 0)
);

CREATE TABLE "AiModerationConfig" (
  "id" TEXT NOT NULL,
  "campusId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "baseUrl" VARCHAR(500) NOT NULL,
  "model" VARCHAR(200) NOT NULL,
  "encryptedApiKey" TEXT NOT NULL,
  "apiKeyLastFour" VARCHAR(4) NOT NULL,
  "encryptionVersion" INTEGER NOT NULL,
  "timeoutMs" INTEGER NOT NULL DEFAULT 8000,
  "reviewThreshold" INTEGER NOT NULL DEFAULT 40,
  "blockThreshold" INTEGER NOT NULL DEFAULT 80,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AiModerationConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiModerationConfig_baseUrl_nonempty_check"
    CHECK (char_length(btrim("baseUrl")) > 0),
  CONSTRAINT "AiModerationConfig_model_nonempty_check"
    CHECK (char_length(btrim("model")) > 0),
  CONSTRAINT "AiModerationConfig_encryptedApiKey_nonempty_check"
    CHECK (char_length("encryptedApiKey") > 0),
  CONSTRAINT "AiModerationConfig_apiKeyLastFour_length_check"
    CHECK (char_length("apiKeyLastFour") = 4),
  CONSTRAINT "AiModerationConfig_encryptionVersion_check"
    CHECK ("encryptionVersion" > 0),
  CONSTRAINT "AiModerationConfig_timeoutMs_check"
    CHECK ("timeoutMs" >= 1000 AND "timeoutMs" <= 60000),
  CONSTRAINT "AiModerationConfig_thresholds_check"
    CHECK (0 <= "reviewThreshold" AND "reviewThreshold" < "blockThreshold" AND "blockThreshold" <= 100)
);

CREATE TABLE "ContentAssessment" (
  "id" TEXT NOT NULL,
  "campusId" TEXT NOT NULL,
  "configId" TEXT,
  "targetType" "ContentAssessmentTarget" NOT NULL,
  "targetId" VARCHAR(200) NOT NULL,
  "decision" "ContentAssessmentDecision" NOT NULL,
  "providerStatus" "ProviderExecutionStatus" NOT NULL,
  "riskScore" INTEGER,
  "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "reasonZh" TEXT,
  "suggestionZh" TEXT,
  "adminSignals" JSONB,
  "model" VARCHAR(200),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContentAssessment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentAssessment_targetId_nonempty_check"
    CHECK (char_length(btrim("targetId")) > 0),
  CONSTRAINT "ContentAssessment_riskScore_check"
    CHECK ("riskScore" IS NULL OR ("riskScore" >= 0 AND "riskScore" <= 100))
);

CREATE UNIQUE INDEX "BlockedWord_campusId_normalized_key"
  ON "BlockedWord"("campusId", "normalized");
CREATE INDEX "BlockedWord_campusId_enabled_category_idx"
  ON "BlockedWord"("campusId", "enabled", "category");

CREATE UNIQUE INDEX "AiModerationConfig_campusId_key"
  ON "AiModerationConfig"("campusId");
CREATE UNIQUE INDEX "AiModerationConfig_id_campusId_key"
  ON "AiModerationConfig"("id", "campusId");

CREATE INDEX "ContentAssessment_campusId_decision_createdAt_id_idx"
  ON "ContentAssessment"("campusId", "decision", "createdAt", "id");
CREATE INDEX "ContentAssessment_campusId_providerStatus_createdAt_id_idx"
  ON "ContentAssessment"("campusId", "providerStatus", "createdAt", "id");
CREATE INDEX "ContentAssessment_targetType_targetId_createdAt_id_idx"
  ON "ContentAssessment"("targetType", "targetId", "createdAt", "id");
CREATE INDEX "ContentAssessment_configId_idx"
  ON "ContentAssessment"("configId");

ALTER TABLE "BlockedWord"
  ADD CONSTRAINT "BlockedWord_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AiModerationConfig"
  ADD CONSTRAINT "AiModerationConfig_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContentAssessment"
  ADD CONSTRAINT "ContentAssessment_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContentAssessment"
  ADD CONSTRAINT "ContentAssessment_configId_campusId_fkey"
  FOREIGN KEY ("configId", "campusId") REFERENCES "AiModerationConfig"("id", "campusId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
