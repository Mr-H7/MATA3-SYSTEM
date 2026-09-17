-- CreateEnum
CREATE TYPE "StorefrontOrderStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "StorefrontOrder" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'STOREFRONT',
    "marketId" TEXT NOT NULL,
    "marketCode" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "StorefrontOrderStatus" NOT NULL DEFAULT 'RECEIVED',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "customerName" TEXT NOT NULL,
    "normalizedPhone" TEXT NOT NULL,
    "email" TEXT,
    "region" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "addressNotes" TEXT,
    "deliveryCode" TEXT NOT NULL,
    "deliveryLabel" TEXT NOT NULL,
    "deliveryAmount" DECIMAL(12,2) NOT NULL,
    "paymentCode" TEXT NOT NULL,
    "paymentLabel" TEXT NOT NULL,
    "itemsSubtotal" DECIMAL(12,2) NOT NULL,
    "adjustments" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(12,2) NOT NULL,
    "confirmationUntil" TIMESTAMP(3) NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorefrontOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorefrontOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "variantLabel" TEXT,
    "attributes" JSONB NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "StorefrontOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorefrontOrderAllocation" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "sourceMarketCode" TEXT NOT NULL,
    "quantityPerOrderUnit" INTEGER NOT NULL,

    CONSTRAINT "StorefrontOrderAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestTrackingThrottle" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL,

    CONSTRAINT "GuestTrackingThrottle_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontOrder_reference_key" ON "StorefrontOrder"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontOrder_idempotencyKey_key" ON "StorefrontOrder"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StorefrontOrder_normalizedPhone_reference_idx" ON "StorefrontOrder"("normalizedPhone", "reference");

-- CreateIndex
CREATE INDEX "StorefrontOrderAllocation_inventoryId_idx" ON "StorefrontOrderAllocation"("inventoryId");

-- AddForeignKey
ALTER TABLE "StorefrontOrder" ADD CONSTRAINT "StorefrontOrder_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontOrderLine" ADD CONSTRAINT "StorefrontOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StorefrontOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontOrderAllocation" ADD CONSTRAINT "StorefrontOrderAllocation_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "StorefrontOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
