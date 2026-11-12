-- Additive on-demand sellability. Existing listings stay unapproved and existing orders stay owned-stock.
CREATE TYPE "OnDemandApproval" AS ENUM ('UNAPPROVED', 'APPROVED');
CREATE TYPE "OnDemandBasis" AS ENUM ('NONE', 'CONFIRMED_AVAILABILITY', 'APPROVED_FULFILLMENT_POLICY');
CREATE TYPE "LineFulfillmentSource" AS ENUM ('OWNED_STOCK', 'SUPPLIER_ON_DEMAND');

ALTER TABLE "MarketListing"
  ADD COLUMN "onDemandApproval" "OnDemandApproval" NOT NULL DEFAULT 'UNAPPROVED',
  ADD COLUMN "onDemandBasis" "OnDemandBasis" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "onDemandMaxPerOrder" INTEGER;

ALTER TABLE "MarketListing"
  ADD CONSTRAINT "MarketListing_onDemandMaxPerOrder_check"
  CHECK ("onDemandMaxPerOrder" IS NULL OR ("onDemandMaxPerOrder" >= 1 AND "onDemandMaxPerOrder" <= 99));

ALTER TABLE "StorefrontOrderLine"
  ADD COLUMN "fulfillmentSource" "LineFulfillmentSource" NOT NULL DEFAULT 'OWNED_STOCK',
  ADD COLUMN "supplierId" TEXT;

ALTER TABLE "WebProductMedia"
  ADD COLUMN "importKey" TEXT;

CREATE UNIQUE INDEX "WebProductMedia_importKey_key" ON "WebProductMedia"("importKey");
