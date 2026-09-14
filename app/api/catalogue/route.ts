import { InventoryType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { canAccessMarket, isSeller, requireUser } from "@/lib/auth";
import { availableStock, resolveListingInventory } from "@/lib/inventory-source";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await requireUser();
  const code = request.nextUrl.searchParams.get("market") || (user.marketScope === "ALL" ? "EGYPT" : user.marketScope);
  if (!canAccessMarket(user, code)) return NextResponse.json({ error: "Market access denied" }, { status: 403 });
  const where = { market: { code }, available: true, product: { status: "ACTIVE" as const } };

  if (isSeller(user)) {
    const rows = await prisma.marketListing.findMany({
      where,
      select: {
        id: true,
        price: true,
        available: true,
        inventoryType: true,
        market: { select: { code: true, currency: true } },
        product: {
          select: {
            id: true,
            sku: true,
            nameAr: true,
            nameEn: true,
            brand: true,
            model: true,
            category: { select: { name: true } },
            images: { where: { isPrimary: true }, take: 1, select: { url: true, alt: true } },
          },
        },
        variant: { select: { id: true, sku: true, color: true, size: true } },
        inventory: { select: { currentStock: true, reservedStock: true } },
        inventorySourceMarketId: true,
        marketId: true,
        productId: true,
        variantId: true,
      },
      orderBy: { product: { nameEn: "asc" } },
    });

    const payload = await Promise.all(
      rows.map(async (row) => {
        const listing = await prisma.marketListing.findUniqueOrThrow({
          where: { id: row.id },
          include: { market: true, inventory: true, inventorySourceMarket: true },
        });
        const resolved = await resolveListingInventory(prisma, listing);
        const stock =
          row.inventoryType === InventoryType.PHYSICAL_STOCK ? availableStock(resolved.inventory) : null;
        const primaryImage = row.product.images[0];
        return {
          id: row.id,
          price: row.price,
          available: row.available,
          inventoryType: row.inventoryType,
          market: row.market,
          product: {
            ...row.product,
            primaryImageUrl: primaryImage?.url ?? null,
            images: undefined,
          },
          variant: row.variant,
          availableStock: stock,
        };
      }),
    );

    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  }

  const rows = await prisma.marketListing.findMany({
    where,
    include: {
      product: { include: { images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] } } },
      variant: true,
      market: true,
      inventory: true,
      inventorySourceMarket: true,
    },
    orderBy: { product: { nameEn: "asc" } },
  });

  const payload = await Promise.all(
    rows.map(async (row) => {
      const resolved = await resolveListingInventory(prisma, row);
      return {
        ...row,
        availableStock: availableStock(resolved.inventory),
        fulfillmentSourceMarketCode: resolved.inventorySourceMarketCode,
      };
    }),
  );

  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
