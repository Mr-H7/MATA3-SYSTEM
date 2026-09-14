import { InventoryType, WebPublicationStatus } from "@prisma/client";
import { availableStock, resolveListingInventory } from "./inventory-source";
import { prisma } from "./prisma";

export async function getPublicProducts(marketCode: string, page = 1, pageSize = 24) {
  const market = await prisma.market.findUniqueOrThrow({ where: { code: marketCode } });
  const skip = Math.max(0, (page - 1) * pageSize);
  const take = Math.min(100, Math.max(1, pageSize));

  const listings = await prisma.marketListing.findMany({
    where: {
      marketId: market.id,
      webPublicationStatus: WebPublicationStatus.PUBLISHED,
      available: true,
      product: { status: "ACTIVE" },
    },
    include: {
      product: {
        include: {
          category: { include: { department: true, parent: true } },
          department: true,
          images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] },
        },
      },
      variant: true,
      inventory: true,
      inventorySourceMarket: true,
      market: true,
    },
    orderBy: { product: { nameEn: "asc" } },
    skip,
    take: take + 1,
  });

  const hasMore = listings.length > take;
  const slice = listings.slice(0, take);
  const items = await Promise.all(
    slice.map(async (listing) => {
      const resolved = await resolveListingInventory(prisma, listing);
      const stock = listing.inventoryType === InventoryType.PHYSICAL_STOCK ? availableStock(resolved.inventory) : null;
      const inStock = listing.inventoryType === InventoryType.PHYSICAL_STOCK ? stock! > 0 : true;
      const primaryImage = listing.product.images.find((image) => image.isPrimary) ?? listing.product.images[0];
      return {
        id: listing.product.id,
        slug: listing.product.publicSlug,
        nameEn: listing.product.nameEn,
        nameAr: listing.product.nameAr,
        descriptionEn: listing.product.descriptionEn,
        descriptionAr: listing.product.descriptionAr,
        brand: listing.product.brand,
        category: listing.product.category?.name ?? null,
        department: listing.product.category?.department.name ?? listing.product.department?.name ?? null,
        market: market.code,
        currency: market.currency,
        price: Number(listing.price),
        variant: listing.variant
          ? {
              id: listing.variant.id,
              sku: listing.variant.sku,
              color: listing.variant.color,
              size: listing.variant.size,
            }
          : null,
        inventoryType: listing.inventoryType,
        inStock,
        availableQuantity: stock,
        primaryImage: primaryImage ? { url: primaryImage.url, alt: primaryImage.alt } : null,
        listingId: listing.id,
      };
    }),
  );

  return { market: market.code, page, pageSize: take, hasMore, items };
}

export async function getPublicProductBySlug(marketCode: string, slug: string) {
  const market = await prisma.market.findUniqueOrThrow({ where: { code: marketCode } });
  const product = await prisma.product.findFirst({
    where: { publicSlug: slug, status: "ACTIVE" },
    include: {
      category: { include: { department: true, parent: true } },
      department: true,
      images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] },
      variants: true,
      listings: {
        where: { marketId: market.id, webPublicationStatus: WebPublicationStatus.PUBLISHED, available: true },
        include: { variant: true, inventory: true, inventorySourceMarket: true, market: true },
      },
    },
  });
  if (!product || !product.listings.length) return null;

  const variants = await Promise.all(
    product.listings.map(async (listing) => {
      const resolved = await resolveListingInventory(prisma, listing);
      const stock = listing.inventoryType === InventoryType.PHYSICAL_STOCK ? availableStock(resolved.inventory) : null;
      return {
        listingId: listing.id,
        sku: listing.variant?.sku ?? product.sku,
        color: listing.variant?.color,
        size: listing.variant?.size,
        price: Number(listing.price),
        currency: market.currency,
        inventoryType: listing.inventoryType,
        inStock: listing.inventoryType === InventoryType.PHYSICAL_STOCK ? (stock ?? 0) > 0 : true,
        availableQuantity: stock,
      };
    }),
  );

  const primaryImage = product.images.find((image) => image.isPrimary) ?? product.images[0];
  return {
    id: product.id,
    slug: product.publicSlug,
    nameEn: product.nameEn,
    nameAr: product.nameAr,
    descriptionEn: product.descriptionEn,
    descriptionAr: product.descriptionAr,
    brand: product.brand,
    category: product.category?.name ?? null,
    department: product.category?.department.name ?? product.department?.name ?? null,
    market: market.code,
    currency: market.currency,
    images: product.images.map((image) => ({ url: image.url, alt: image.alt, isPrimary: image.isPrimary })),
    primaryImage: primaryImage ? { url: primaryImage.url, alt: primaryImage.alt } : null,
    variants,
  };
}
