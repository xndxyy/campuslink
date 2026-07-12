CREATE TYPE "MarketplaceCondition" AS ENUM ('NEW', 'LIKE_NEW', 'GOOD', 'FAIR');

ALTER TABLE "MarketplaceItem"
  ADD COLUMN "pickupArea" VARCHAR(200) NOT NULL DEFAULT 'Campus pickup',
  ALTER COLUMN "condition" TYPE "MarketplaceCondition"
    USING CASE
      WHEN "condition" IN ('NEW', 'LIKE_NEW', 'GOOD', 'FAIR')
        THEN "condition"::"MarketplaceCondition"
      ELSE 'GOOD'::"MarketplaceCondition"
    END;

ALTER TABLE "MarketplaceItem" ALTER COLUMN "pickupArea" DROP DEFAULT;
