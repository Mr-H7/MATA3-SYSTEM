import { Gender, InventoryType, Prisma, ProductStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { canAccessMarket, canManageGlobalData, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type VariantInput = { sku: string; color?: string; size?: string; material?: string; supplierCode?: string; barcode?: string };
type ListingInput = { marketCode: string; variantSku?: string; supplierId?: string; cost: number; price: number; compareAt?: number; available?: boolean; inventoryType?: InventoryType; minimumStock?: number; notes?: string; stock?: number };

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const variants = (body.variants ?? []) as VariantInput[];
    const listings = (body.listings ?? body.markets ?? []) as ListingInput[];
    if (!canManageGlobalData(user.role)) return NextResponse.json({ error: "Only OWNER or ADMIN can create master products" }, { status: 403 });
    if (!body.sku?.trim() || !body.nameAr?.trim() || !body.nameEn?.trim()) return NextResponse.json({ error: "SKU, Arabic name, and English name are required" }, { status: 400 });
    if (!listings.length) return NextResponse.json({ error: "At least one market listing is required" }, { status: 400 });
    if (listings.some((listing) => typeof listing.marketCode !== "string" || !listing.marketCode.trim())) return NextResponse.json({ error: "Market code is required for every market listing." }, { status: 400 });
    if (variants.some((variant) => !variant.sku?.trim())) return NextResponse.json({ error: "Every variant requires a SKU" }, { status: 400 });
    if (listings.some((listing) => Number(listing.cost) < 0 || Number(listing.price) < 0 || !Number.isInteger(Number(listing.minimumStock ?? 0)) || Number(listing.minimumStock ?? 0) < 0)) return NextResponse.json({ error: "Costs, prices, and minimum stock must be non-negative" }, { status: 400 });

    const result = await prisma.$transaction(async (tx) => {
      const marketCodes = [...new Set(listings.map((listing) => listing.marketCode.trim()))];
      const markets = await tx.market.findMany({ where: { code: { in: marketCodes } } });
      const invalidMarketCode = marketCodes.find((code) => !markets.some((market) => market.code === code));
      if (invalidMarketCode) throw new Error(`Invalid market code: ${invalidMarketCode}`);
      for (const market of markets) if (!canAccessMarket(user, market.code)) throw new Error("MARKET_ACCESS_DENIED");
      const product = await tx.product.create({ data: { sku: body.sku.trim(), nameEn: body.nameEn.trim(), nameAr: body.nameAr.trim(), descriptionEn: body.descriptionEn || null, descriptionAr: body.descriptionAr || null, brand: body.brand || null, model: body.model || null, gender: (body.gender || Gender.NA) as Gender, status: (body.status || ProductStatus.DRAFT) as ProductStatus, internalNotes: body.internalNotes || null, departmentId: body.departmentId || null, categoryId: body.categoryId || null } });
      const createdVariants = new Map<string, string>();
      for (const variant of variants) { const created = await tx.productVariant.create({ data: { productId: product.id, sku: variant.sku.trim(), color: variant.color || null, size: variant.size || null, material: variant.material || null, supplierCode: variant.supplierCode || null, barcode: variant.barcode || null } }); createdVariants.set(created.sku, created.id); }
      for (const listingInput of listings) {
        const market = markets.find((candidate) => candidate.code === listingInput.marketCode.trim())!;
        const variantId = listingInput.variantSku ? createdVariants.get(listingInput.variantSku) : variants.length === 1 ? createdVariants.get(variants[0].sku) : undefined;
        if (listingInput.variantSku && !variantId) throw new Error(`Unknown variant SKU ${listingInput.variantSku}`);
        const listing = await tx.marketListing.create({ data: { productId: product.id, variantId: variantId ?? null, marketId: market.id, supplierId: listingInput.supplierId || null, cost: new Prisma.Decimal(listingInput.cost), price: new Prisma.Decimal(listingInput.price), compareAt: listingInput.compareAt == null ? null : new Prisma.Decimal(listingInput.compareAt), available: listingInput.available ?? true, inventoryType: listingInput.inventoryType || InventoryType.PHYSICAL_STOCK, minimumStock: Number(listingInput.minimumStock ?? 0), notes: listingInput.notes || null } });
        await tx.inventory.create({ data: { listingId: listing.id, marketId: market.id, currentStock: listing.inventoryType === InventoryType.PHYSICAL_STOCK ? Number(listingInput.stock ?? 0) : 0 } });
      }
      await tx.auditLog.create({ data: { userId: user.id, action: "PRODUCT_CREATE", entity: "Product", entityId: product.id } });
      return product;
    });
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Product creation failed";
    return NextResponse.json({ error: message === "MARKET_ACCESS_DENIED" ? "Market access denied" : message }, { status: message === "MARKET_ACCESS_DENIED" ? 403 : 400 });
  }
}
