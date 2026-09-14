import type { Inventory, Market, MarketListing, Prisma } from "@prisma/client";

type ListingWithRelations = MarketListing & {
  market: Market;
  inventory: Inventory | null;
};

type ResolvedInventory = {
  inventory: Inventory | null;
  inventorySourceMarketCode: string;
};

export function effectiveSourceMarketId(listing: Pick<MarketListing, "marketId" | "inventorySourceMarketId">) {
  return listing.inventorySourceMarketId ?? listing.marketId;
}

export async function resolveListingInventory(
  tx: Prisma.TransactionClient,
  listing: ListingWithRelations,
): Promise<ResolvedInventory> {
  const sourceMarketId = effectiveSourceMarketId(listing);
  if (sourceMarketId === listing.marketId) {
    return { inventory: listing.inventory, inventorySourceMarketCode: listing.market.code };
  }
  const sourceMarket = await tx.market.findUniqueOrThrow({ where: { id: sourceMarketId } });
  const sourceListing = await tx.marketListing.findFirst({
    where: {
      productId: listing.productId,
      variantId: listing.variantId,
      marketId: sourceMarketId,
    },
    include: { inventory: true },
  });
  if (!sourceListing) {
    throw new Error(`No source-market listing exists for this variant (${sourceMarket.code})`);
  }
  return { inventory: sourceListing.inventory, inventorySourceMarketCode: sourceMarket.code };
}

export function availableStock(inventory: Inventory | null | undefined) {
  if (!inventory) return 0;
  return Math.max(0, inventory.currentStock - inventory.reservedStock);
}
