-- Pending registrations deliberately do not contain credentials. The holder
-- of the one-time verification link chooses the password during activation.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- One expiring bucket per hashed, bounded rate-limit key. Raw client input is
-- never persisted, and expired buckets are removed by the application.
CREATE TABLE "RateLimitBucket" (
    "keyHash" VARCHAR(64) NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("keyHash")
);

CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");
