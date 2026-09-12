import { canAccessMarket } from "@/lib/auth";
import { requireOwnerPage } from "@/lib/page-auth";
import { prisma } from "@/lib/prisma";
import InventoryClient from "./inventory-client";

export const dynamic = "force-dynamic";

export default async function Inventory() {
  const user = await requireOwnerPage();
  const [allRows, movements] = await Promise.all([
    prisma.inventory.findMany({ include: { market: true, listing: { include: { product: true, variant: true, supplier: true } } }, orderBy: { listing: { product: { nameEn: "asc" } } } }),
    prisma.inventoryMovement.findMany({
      include: {
        user: { select: { name: true } },
        inventory: {
          include: {
            market: true,
            listing: { include: { product: { select: { nameEn: true, sku: true } }, variant: { select: { sku: true } } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
  ]);
  const rows = allRows.filter((row) => canAccessMarket(user, row.market.code));
  const visibleMovements = movements.filter((movement) => canAccessMarket(user, movement.inventory.market.code));
  return <InventoryClient rows={JSON.parse(JSON.stringify(rows))} movements={JSON.parse(JSON.stringify(visibleMovements))} />;
}
