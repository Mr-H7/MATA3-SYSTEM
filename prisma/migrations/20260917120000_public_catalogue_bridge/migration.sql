-- Additive catalogue identity and publication. Existing bundles and media stay unpublished.
ALTER TABLE "Category" ADD COLUMN "publicKey" TEXT;
UPDATE "Category" SET "publicKey" = gen_random_uuid()::text WHERE "publicKey" IS NULL;
ALTER TABLE "Category" ALTER COLUMN "publicKey" SET NOT NULL;
CREATE UNIQUE INDEX "Category_publicKey_key" ON "Category"("publicKey");

ALTER TABLE "MarketListing" ADD COLUMN "publicOfferId" TEXT;
UPDATE "MarketListing" SET "publicOfferId" = gen_random_uuid()::text WHERE "publicOfferId" IS NULL;
ALTER TABLE "MarketListing" ALTER COLUMN "publicOfferId" SET NOT NULL;
CREATE UNIQUE INDEX "MarketListing_publicOfferId_key" ON "MarketListing"("publicOfferId");
-- PostgreSQL treats NULL as distinct in ordinary unique indexes. Abort on duplicates; never merge data.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "MarketListing" WHERE "variantId" IS NULL GROUP BY "productId", "marketId" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate product-only MarketListing rows require manual review';
  END IF;
END $$;
CREATE UNIQUE INDEX "MarketListing_productId_marketId_no_variant_key" ON "MarketListing"("productId", "marketId") WHERE "variantId" IS NULL;

ALTER TABLE "Bundle" ADD COLUMN "publicSlug" TEXT;
CREATE UNIQUE INDEX "Bundle_publicSlug_key" ON "Bundle"("publicSlug");
ALTER TABLE "BundleMarketListing" ADD COLUMN "publicOfferId" TEXT;
UPDATE "BundleMarketListing" SET "publicOfferId" = gen_random_uuid()::text WHERE "publicOfferId" IS NULL;
ALTER TABLE "BundleMarketListing" ALTER COLUMN "publicOfferId" SET NOT NULL;
ALTER TABLE "BundleMarketListing" ADD COLUMN "webPublicationStatus" "WebPublicationStatus" NOT NULL DEFAULT 'DRAFT';
CREATE UNIQUE INDEX "BundleMarketListing_publicOfferId_key" ON "BundleMarketListing"("publicOfferId");

CREATE TYPE "WebMediaType" AS ENUM ('IMAGE', 'VIDEO');
CREATE TABLE "WebProductMedia" (
  "id" TEXT NOT NULL,
  "type" "WebMediaType" NOT NULL,
  "storageKey" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "altText" TEXT NOT NULL,
  "isCover" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "publicationStatus" "WebPublicationStatus" NOT NULL DEFAULT 'DRAFT',
  "productId" TEXT,
  "variantId" TEXT,
  "bundleId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebProductMedia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebProductMedia_one_target" CHECK (num_nonnulls("productId", "variantId", "bundleId") = 1)
);
ALTER TABLE "WebProductMedia" ADD CONSTRAINT "WebProductMedia_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebProductMedia" ADD CONSTRAINT "WebProductMedia_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebProductMedia" ADD CONSTRAINT "WebProductMedia_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "WebProductMedia_productId_publicationStatus_sortOrder_idx" ON "WebProductMedia"("productId", "publicationStatus", "sortOrder");
CREATE INDEX "WebProductMedia_variantId_publicationStatus_sortOrder_idx" ON "WebProductMedia"("variantId", "publicationStatus", "sortOrder");
CREATE INDEX "WebProductMedia_bundleId_publicationStatus_sortOrder_idx" ON "WebProductMedia"("bundleId", "publicationStatus", "sortOrder");
