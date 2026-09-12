import { Prisma, ProductStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { canAccessMarket, canManageGlobalData, isSeller, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const user = await requireUser(); const { id } = await params; const bundle = await prisma.bundle.findUniqueOrThrow({ where: { id }, include: { items: true, listings: { include: { market: true } } } }); const listings = bundle.listings.filter((listing) => canAccessMarket(user, listing.market.code)); if (!canManageGlobalData(user.role) && !listings.length) return NextResponse.json({ error: "Market access denied" }, { status: 403 }); if(isSeller(user))return NextResponse.json({id:bundle.id,name:bundle.name,status:bundle.status,listings:listings.map(listing=>({id:listing.id,price:listing.price,market:{code:listing.market.code,currency:listing.market.currency}}))},{headers:{"Cache-Control":"no-store"}});return NextResponse.json({ ...bundle, listings }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Bundle not found" }, { status: 404 }); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(); if (!canManageGlobalData(user.role)) return NextResponse.json({ error: "Only OWNER or ADMIN can edit bundles" }, { status: 403 });
    const { id } = await params; const body = await request.json();
    if (!Array.isArray(body.listings) || body.listings.some((listing: { marketCode?: unknown }) => typeof listing.marketCode !== "string" || !listing.marketCode.trim())) return NextResponse.json({ error: "Market code is required for every market listing." }, { status: 400 });
    await prisma.$transaction(async (tx) => {
      const marketCodes = [...new Set<string>(body.listings.map((listing: { marketCode: string }) => listing.marketCode.trim()))]; const markets = await tx.market.findMany({ where: { code: { in: marketCodes } } }); const invalidMarketCode=marketCodes.find((code)=>!markets.some((market)=>market.code===code)); if (invalidMarketCode) throw new Error(`Invalid market code: ${invalidMarketCode}`);
      for (const market of markets) if (!canAccessMarket(user, market.code)) throw new Error("MARKET_ACCESS_DENIED");
      if (!body.name?.trim() || !body.items?.length || !body.listings?.length) throw new Error("Name, components, and at least one market listing are required");
      for (const item of body.items) if (!Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0) throw new Error("Component quantities must be positive integers");
      for (const listing of body.listings) if (Number(listing.cost) < 0 || Number(listing.individualTotal) < 0 || Number(listing.price) < 0) throw new Error("Bundle amounts cannot be negative");
      await tx.bundle.update({ where: { id }, data: { name: body.name.trim(), status: body.status as ProductStatus } });
      await tx.bundleItem.deleteMany({ where: { bundleId: id } }); await tx.bundleMarketListing.deleteMany({ where: { bundleId: id } });
      await tx.bundleItem.createMany({ data: body.items.map((item: { productId?: string; variantId?: string; quantity: number }) => ({ bundleId: id, productId: item.productId || null, variantId: item.variantId || null, quantity: Number(item.quantity) })) });
      await tx.bundleMarketListing.createMany({ data: body.listings.map((listing: { marketCode: string; cost: number; individualTotal: number; price: number }) => ({ bundleId: id, marketId: markets.find((market) => market.code === listing.marketCode.trim())!.id, cost: new Prisma.Decimal(listing.cost), individualTotal: new Prisma.Decimal(listing.individualTotal), price: new Prisma.Decimal(listing.price) })) });
    }); return NextResponse.json({ ok: true });
  } catch (error) { const message = error instanceof Error ? error.message : "Bundle update failed"; return NextResponse.json({ error: message === "MARKET_ACCESS_DENIED" ? "Market access denied" : message }, { status: message === "MARKET_ACCESS_DENIED" ? 403 : 400 }); }
}
