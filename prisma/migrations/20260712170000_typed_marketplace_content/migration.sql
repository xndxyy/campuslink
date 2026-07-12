DO $$
DECLARE
  unsupported_values TEXT;
BEGIN
  SELECT string_agg(DISTINCT "condition", ', ' ORDER BY "condition")
  INTO unsupported_values
  FROM "MarketplaceItem"
  WHERE "condition" IS NOT NULL
    AND lower(trim("condition")) NOT IN (
      'new', 'unopened', 'like new', 'like_new', 'excellent', 'good', 'fair', 'poor'
    );

  IF unsupported_values IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported MarketplaceItem.condition values: %', unsupported_values;
  END IF;
END $$;

CREATE TYPE "MarketplaceCondition" AS ENUM ('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR');

ALTER TABLE "MarketplaceItem"
  ADD COLUMN "pickupArea" VARCHAR(200) NOT NULL DEFAULT 'Campus pickup',
  ALTER COLUMN "condition" TYPE "MarketplaceCondition"
    USING (
      CASE lower(trim("condition"))
        WHEN 'new' THEN 'NEW'
        WHEN 'unopened' THEN 'NEW'
        WHEN 'like new' THEN 'LIKE_NEW'
        WHEN 'like_new' THEN 'LIKE_NEW'
        WHEN 'excellent' THEN 'LIKE_NEW'
        WHEN 'good' THEN 'GOOD'
        WHEN 'fair' THEN 'FAIR'
        WHEN 'poor' THEN 'POOR'
      END
    )::"MarketplaceCondition";

ALTER TABLE "MarketplaceItem" ALTER COLUMN "pickupArea" DROP DEFAULT;
