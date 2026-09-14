import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { availableStock, resolveListingInventory } from "@/lib/inventory-source";
import { prisma } from "@/lib/prisma";
import WebProductsClient from "./web-products-client";

export const dynamic = "force-dynamic";

export default async function WebProductsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "OWNER") redirect("/");

  const rows = await prisma.marketListing.findMany({
    where: { product: { status: { not: "ARCHIVED" } } },
    include: {
      product: { include: { images: { where: { isPrimary: true }, take: 1 }, category: true } },
      variant: true,
      market: true,
      inventory: true,
      inventorySourceMarket: true,
    },
    orderBy: [{ product: { nameEn: "asc" } }, { market: { code: "asc" } }],
  });

  const enriched = await Promise.all(
    rows.map(async (row) => {
      const resolved = await resolveListingInventory(prisma, row);
      return { ...row, availableStock: availableStock(resolved.inventory) };
    }),
  );

  return <WebProductsClient initialRows={JSON.parse(JSON.stringify(enriched))} />;
}
