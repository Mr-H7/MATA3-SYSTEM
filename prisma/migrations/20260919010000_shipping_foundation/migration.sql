-- CreateEnum
CREATE TYPE "ShippingProvider" AS ENUM ('BOSTA', 'OZONEXPRESS');

-- CreateEnum
CREATE TYPE "ShippingPricingProvenance" AS ENUM ('APPROVED_TARIFF', 'PROVIDER_QUOTE');

-- CreateEnum
CREATE TYPE "ShippingDestinationKind" AS ENUM ('REGION', 'CITY', 'DISTRICT');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('NOT_READY', 'READY_FOR_FULFILLMENT', 'MANUAL_FULFILLMENT', 'PROVIDER_PENDING', 'PROVIDER_CREATED', 'FULFILLED', 'FULFILLMENT_EXCEPTION');

-- AlterTable
ALTER TABLE "StorefrontOrder" ADD COLUMN     "fulfillmentStatus" "FulfillmentStatus" NOT NULL DEFAULT 'NOT_READY',
ADD COLUMN     "shippingDestinationId" TEXT,
ADD COLUMN     "shippingDestinationSnapshot" JSONB,
ADD COLUMN     "shippingPricingProvenance" "ShippingPricingProvenance",
ADD COLUMN     "shippingProvider" "ShippingProvider",
ADD COLUMN     "shippingTariffId" TEXT;

-- CreateTable
CREATE TABLE "ShippingMarketConfiguration" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingMarketConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingDestination" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "kind" "ShippingDestinationKind" NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "tariffGroupCode" TEXT,
    "providerCityId" TEXT,
    "providerZoneId" TEXT,
    "providerDistrictId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingMethod" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "provider" "ShippingProvider" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingTariff" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "destinationId" TEXT,
    "destinationGroupCode" TEXT,
    "packageClass" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "provenance" "ShippingPricingProvenance" NOT NULL DEFAULT 'APPROVED_TARIFF',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingTariff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShippingMarketConfiguration_marketId_key" ON "ShippingMarketConfiguration"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingDestination_publicKey_key" ON "ShippingDestination"("publicKey");

-- CreateIndex
CREATE INDEX "ShippingDestination_marketId_parentId_active_idx" ON "ShippingDestination"("marketId", "parentId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingMethod_marketId_code_key" ON "ShippingMethod"("marketId", "code");

-- CreateIndex
CREATE INDEX "ShippingTariff_marketId_methodId_active_effectiveFrom_idx" ON "ShippingTariff"("marketId", "methodId", "active", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ShippingTariff_destinationId_idx" ON "ShippingTariff"("destinationId");

-- AddForeignKey
ALTER TABLE "ShippingMarketConfiguration" ADD CONSTRAINT "ShippingMarketConfiguration_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingDestination" ADD CONSTRAINT "ShippingDestination_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingDestination" ADD CONSTRAINT "ShippingDestination_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ShippingDestination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingMethod" ADD CONSTRAINT "ShippingMethod_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingTariff" ADD CONSTRAINT "ShippingTariff_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingTariff" ADD CONSTRAINT "ShippingTariff_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "ShippingMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingTariff" ADD CONSTRAINT "ShippingTariff_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "ShippingDestination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontOrder" ADD CONSTRAINT "StorefrontOrder_shippingDestinationId_fkey" FOREIGN KEY ("shippingDestinationId") REFERENCES "ShippingDestination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Guard approved minor-unit tariff records and explicit destination scope.
ALTER TABLE "ShippingTariff" ADD CONSTRAINT "ShippingTariff_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "ShippingTariff" ADD CONSTRAINT "ShippingTariff_scope_exactly_one" CHECK (("destinationId" IS NOT NULL) <> ("destinationGroupCode" IS NOT NULL));
ALTER TABLE "ShippingTariff" ADD CONSTRAINT "ShippingTariff_dates_ordered" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
