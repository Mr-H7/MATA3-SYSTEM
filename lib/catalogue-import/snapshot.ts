import type { PrismaClient } from "@prisma/client";
import type { CatalogueSnapshot } from "./types";

export async function loadCatalogueSnapshot(prisma: PrismaClient): Promise<CatalogueSnapshot> {
  const [markets, departments, categories, suppliers, products] = await Promise.all([
    prisma.market.findMany({ select: { id: true, code: true, currency: true } }),
    prisma.department.findMany({ select: { id: true, name: true } }),
    prisma.category.findMany({ select: { id: true, name: true, departmentId: true, archived: true } }),
    prisma.supplier.findMany({ select: { id: true, name: true } }),
    prisma.product.findMany({
      select: {
        id: true,
        sku: true,
        nameAr: true,
        nameEn: true,
        brand: true,
        model: true,
        gender: true,
        status: true,
        publicSlug: true,
        internalNotes: true,
        departmentId: true,
        categoryId: true,
        variants: { select: { id: true, sku: true, color: true, size: true, material: true } },
        suppliers: { select: { supplierId: true } },
        listings: {
          select: {
            id: true,
            variantId: true,
            marketId: true,
            supplierId: true,
            cost: true,
            price: true,
            available: true,
            inventoryType: true,
            notes: true,
            webPublicationStatus: true,
            inventorySourceMarketId: true,
            inventory: { select: { currentStock: true } },
          },
        },
      },
    }),
  ]);
  return {
    markets,
    departments,
    categories,
    suppliers,
    products: products.map((product) => ({
      ...product,
      listings: product.listings.map((listing) => ({
        ...listing,
        cost: listing.cost.toFixed(2),
        price: listing.price.toFixed(2),
        currentStock: listing.inventory?.currentStock ?? 0,
      })),
    })),
  };
}
