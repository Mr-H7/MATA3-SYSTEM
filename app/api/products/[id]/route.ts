import { Gender, InventoryType, Prisma, ProductStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { canAccessMarket, canManageGlobalData, isSeller, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const product = await prisma.product.findUniqueOrThrow({ where: { id }, include: { department: true, category: true, variants: true, listings: { include: { market: true, inventory: true, supplier: true } } } });
    const listings = product.listings.filter((listing) => canAccessMarket(user, listing.market.code));
    if (!canManageGlobalData(user.role) && !listings.length) return NextResponse.json({ error: "Market access denied" }, { status: 403 });
    if (isSeller(user)) return NextResponse.json({ id: product.id, sku: product.sku, nameAr: product.nameAr, nameEn: product.nameEn, brand: product.brand, model: product.model, category: product.category, variants: product.variants.map((variant) => ({ id: variant.id, sku: variant.sku, color: variant.color, size: variant.size })), listings: listings.map((listing) => ({ id: listing.id, price: listing.price, available: listing.available, market: { code: listing.market.code, currency: listing.market.currency }, availableStock: Math.max(0, (listing.inventory?.currentStock ?? 0) - (listing.inventory?.reservedStock ?? 0)) })) }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ ...product, listings });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Product not found" }, { status: 404 }); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    if (isSeller(user)) return NextResponse.json({ error: "You do not have permission to perform this action" }, { status: 403 });
    const { id } = await params;
    const body = await request.json();
    if (body.marketCode) {
      const market = await prisma.market.findUniqueOrThrow({ where: { code: body.marketCode } });
      if (!canAccessMarket(user, market.code)) return NextResponse.json({ error: "Market access denied" }, { status: 403 });
      const listing = body.listingId ? await prisma.marketListing.findFirstOrThrow({ where: { id: body.listingId, productId: id, marketId: market.id } }) : await prisma.marketListing.findFirstOrThrow({ where: { productId: id, marketId: market.id, variantId: body.variantId || null } });
      if (Number(body.cost) < 0 || Number(body.price) < 0 || !Number.isInteger(Number(body.minimumStock ?? listing.minimumStock)) || Number(body.minimumStock ?? listing.minimumStock) < 0) return NextResponse.json({ error: "Cost, price, and minimum stock must be non-negative" }, { status: 400 });
      await prisma.$transaction(async(tx)=>{await tx.marketListing.update({ where: { id: listing.id }, data: { cost: body.cost == null ? undefined : new Prisma.Decimal(body.cost), price: body.price == null ? undefined : new Prisma.Decimal(body.price), compareAt: body.compareAt === undefined ? undefined : body.compareAt === null ? null : new Prisma.Decimal(body.compareAt), available: body.available, inventoryType: body.inventoryType as InventoryType | undefined, minimumStock: body.minimumStock, notes: body.notes, supplierId: body.supplierId === undefined ? undefined : body.supplierId || null } });if(body.price!=null&&Number(body.price)!==Number(listing.price))await tx.auditLog.create({data:{userId:user.id,action:"PRICE_CHANGE",entity:"MarketListing",entityId:listing.id,marketId:market.id,metadata:{from:Number(listing.price),to:Number(body.price)}}});if(body.cost!=null&&Number(body.cost)!==Number(listing.cost))await tx.auditLog.create({data:{userId:user.id,action:"COST_CHANGE",entity:"MarketListing",entityId:listing.id,marketId:market.id,metadata:{from:Number(listing.cost),to:Number(body.cost)}}})});
      return NextResponse.json({ ok: true });
    }

    if (!canManageGlobalData(user.role)) return NextResponse.json({ error: "Only OWNER or ADMIN can edit master product data" }, { status: 403 });
    if (body.status === ProductStatus.ARCHIVED && body.variants === undefined && body.listings === undefined) { await prisma.$transaction([prisma.product.update({ where: { id }, data: { status: ProductStatus.ARCHIVED } }),prisma.auditLog.create({data:{userId:user.id,action:"PRODUCT_ARCHIVE",entity:"Product",entityId:id}})]); return NextResponse.json({ ok: true }); }
    const { variants = [], listings = [], ...rawProduct } = body;
    if (listings.some((listing: { marketCode?: unknown }) => typeof listing.marketCode !== "string" || !listing.marketCode.trim())) return NextResponse.json({ error: "Market code is required for every market listing." }, { status: 400 });
    const productData = { sku: rawProduct.sku, nameAr: rawProduct.nameAr, nameEn: rawProduct.nameEn, descriptionAr: rawProduct.descriptionAr || null, descriptionEn: rawProduct.descriptionEn || null, departmentId: rawProduct.departmentId || null, categoryId: rawProduct.categoryId || null, brand: rawProduct.brand || null, model: rawProduct.model || null, gender: rawProduct.gender as Gender | undefined, status: rawProduct.status as ProductStatus | undefined, internalNotes: rawProduct.internalNotes || null };
    await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data: productData });
      for (const variant of variants) {
        const data = { sku: String(variant.sku).trim(), color: variant.color || null, size: variant.size || null, material: variant.material || null, supplierCode: variant.supplierCode || null, barcode: variant.barcode || null };
        if (!data.sku) throw new Error("Every variant requires a SKU");
        if (variant.id) await tx.productVariant.update({ where: { id: variant.id, productId: id }, data }); else await tx.productVariant.create({ data: { ...data, productId: id } });
      }
      for (const listing of listings) {
        if (Number(listing.cost) < 0 || Number(listing.price) < 0 || !Number.isInteger(Number(listing.minimumStock)) || Number(listing.minimumStock) < 0) throw new Error("Cost, price, and minimum stock must be non-negative");
        if (listing.id) {
          const existing = await tx.marketListing.findFirstOrThrow({ where: { id: listing.id, productId: id }, include: { market: true } });
          if (!canAccessMarket(user, existing.market.code)) throw new Error("MARKET_ACCESS_DENIED");
          await tx.marketListing.update({ where: { id: existing.id }, data: { supplierId: listing.supplierId || null, cost: new Prisma.Decimal(listing.cost), price: new Prisma.Decimal(listing.price), compareAt: listing.compareAt == null ? null : new Prisma.Decimal(listing.compareAt), available: Boolean(listing.available), inventoryType: listing.inventoryType as InventoryType, minimumStock: Number(listing.minimumStock), notes: listing.notes || null } });
        } else {
          const market = await tx.market.findUnique({ where: { code: listing.marketCode.trim() } }); if (!market) throw new Error(`Invalid market code: ${listing.marketCode}`); if (!canAccessMarket(user, market.code)) throw new Error("MARKET_ACCESS_DENIED");
          const variantId = listing.variantSku ? (await tx.productVariant.findFirstOrThrow({ where: { productId: id, sku: listing.variantSku } })).id : null;
          const created = await tx.marketListing.create({ data: { productId: id, variantId, marketId: market.id, supplierId: listing.supplierId || null, cost: new Prisma.Decimal(listing.cost), price: new Prisma.Decimal(listing.price), compareAt: listing.compareAt == null ? null : new Prisma.Decimal(listing.compareAt), available: Boolean(listing.available), inventoryType: listing.inventoryType as InventoryType, minimumStock: Number(listing.minimumStock), notes: listing.notes || null } });
          await tx.inventory.create({ data: { listingId: created.id, marketId: market.id, currentStock: 0 } });
        }
      }
      await tx.auditLog.create({ data: { userId: user.id, action: "PRODUCT_EDIT", entity: "Product", entityId: id } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed";
    return NextResponse.json({ error: message === "MARKET_ACCESS_DENIED" ? "Market access denied" : message }, { status: message === "MARKET_ACCESS_DENIED" ? 403 : 400 });
  }
}
