-- CreateEnum
CREATE TYPE "WebPublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'HIDDEN');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "publicSlug" TEXT;

-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProductImage" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProductImage" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ProductImage" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "MarketListing" ADD COLUMN "inventorySourceMarketId" TEXT;
ALTER TABLE "MarketListing" ADD COLUMN "webPublicationStatus" "WebPublicationStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "MarketListing" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN "inventorySourceMarketCode" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SaleItem" ADD COLUMN "inventorySnapshotVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SaleItemInventoryAllocation" (
    "id" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "sourceMarketCode" TEXT NOT NULL,
    "quantityPerSaleUnit" INTEGER NOT NULL,

    CONSTRAINT "SaleItemInventoryAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_publicSlug_key" ON "Product"("publicSlug");
CREATE INDEX "SaleItemInventoryAllocation_saleItemId_idx" ON "SaleItemInventoryAllocation"("saleItemId");
CREATE INDEX "SaleItemInventoryAllocation_inventoryId_idx" ON "SaleItemInventoryAllocation"("inventoryId");

-- AddForeignKey
ALTER TABLE "MarketListing" ADD CONSTRAINT "MarketListing_inventorySourceMarketId_fkey" FOREIGN KEY ("inventorySourceMarketId") REFERENCES "Market"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SaleItemInventoryAllocation" ADD CONSTRAINT "SaleItemInventoryAllocation_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleItemInventoryAllocation" ADD CONSTRAINT "SaleItemInventoryAllocation_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill inventory source to selling market
UPDATE "MarketListing"
SET "inventorySourceMarketId" = "marketId"
WHERE "inventorySourceMarketId" IS NULL;

-- Backfill historical sale item source snapshots (local-source assumption for legacy sales)
UPDATE "SaleItem" AS si
SET "inventorySourceMarketCode" = si."marketCode"
WHERE si."inventorySourceMarketCode" = '' AND si."marketCode" <> '';

-- Ensure catalogue departments exist (idempotent)
INSERT INTO "Department" ("id", "name")
VALUES
  ('dept-gaming', 'Gaming'),
  ('dept-computer-accessories', 'Computer Accessories'),
  ('dept-mens-fashion', 'Men''s Fashion'),
  ('dept-womens-fashion', 'Women''s Fashion'),
  ('dept-womens-bags', 'Women''s Bags')
ON CONFLICT ("name") DO NOTHING;
