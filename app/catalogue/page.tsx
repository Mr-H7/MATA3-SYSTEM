import { redirect } from "next/navigation";
import { canAccessMarket, getSessionUser, isSeller } from "@/lib/auth";
import { availableStock, resolveListingInventory } from "@/lib/inventory-source";
import { prisma } from "@/lib/prisma";
import CatalogueClient from "./catalogue-client";

export const dynamic = "force-dynamic";

export default async function Catalogue() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  if (isSeller(user)) {
    const rows = await prisma.marketListing.findMany({
      where: {
        available: true,
        product: { status: "ACTIVE" },
        market: { code: user.marketScope === "ALL" ? undefined : user.marketScope },
      },
      select: {
        id: true,
        price: true,
        available: true,
        productId: true,
        product: {
          select: {
            sku: true,
            nameEn: true,
            nameAr: true,
            status: true,
            brand: true,
            model: true,
            images: { where: { isPrimary: true }, take: 1, select: { url: true } },
          },
        },
        variant: { select: { sku: true, color: true, size: true } },
        market: { select: { code: true, currency: true } },
      },
      orderBy: { id: "desc" },
    });

    const enriched = await Promise.all(
      rows.map(async (row) => {
        const listing = await prisma.marketListing.findUniqueOrThrow({
          where: { id: row.id },
          include: { market: true, inventory: true, inventorySourceMarket: true },
        });
        const resolved = await resolveListingInventory(prisma, listing);
        return {
          ...row,
          product: { ...row.product, primaryImageUrl: row.product.images[0]?.url ?? null, images: undefined },
          availableStock: availableStock(resolved.inventory),
        };
      }),
    );

    return <CatalogueClient seller initialRows={JSON.parse(JSON.stringify(enriched))} />;
  }

  const rows = (
    await prisma.marketListing.findMany({
      include: {
        product: { include: { category: true, department: true, images: { where: { isPrimary: true }, take: 1 } } },
        variant: true,
        market: true,
        supplier: true,
        inventory: true,
        inventorySourceMarket: true,
      },
      orderBy: { id: "desc" },
    })
  ).filter((row) => canAccessMarket(user, row.market.code));

  const enriched = await Promise.all(
    rows.map(async (row) => {
      const resolved = await resolveListingInventory(prisma, row);
      return {
        ...row,
        product: { ...row.product, primaryImageUrl: row.product.images[0]?.url ?? null },
        availableStock: availableStock(resolved.inventory),
        fulfillmentSourceMarketCode: resolved.inventorySourceMarketCode,
      };
    }),
  );

  return <CatalogueClient initialRows={JSON.parse(JSON.stringify(enriched))} />;
}
