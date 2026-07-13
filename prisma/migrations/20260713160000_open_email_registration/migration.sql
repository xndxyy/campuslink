-- The legacy domain remains available for compatibility but no longer gates
-- registration or campus configuration.
ALTER TABLE "Campus" ALTER COLUMN "allowedEmailDomain" DROP NOT NULL;
