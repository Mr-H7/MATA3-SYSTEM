import { Prisma, ProductStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { canAccessMarket, canManageGlobalData, isSeller, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await requireUser();
  const bundles = await prisma.bundle.findMany({ include: { items: { include: { product: true, variant: true } }, listings: { include: { market: true } } }, orderBy: { name: "asc" } });
  const visible = bundles.map((bundle) => ({ ...bundle, listings: bundle.listings.filter((listing) => canAccessMarket(user, listing.market.code)) })).filter((bundle) => bundle.listings.length);
  if (isSeller(user)) return NextResponse.json(visible.map((bundle) => ({ id: bundle.id, name: bundle.name, status: bundle.status, listings: bundle.listings.map((listing) => ({ id: listing.id, price: listing.price, market: { code: listing.market.code, currency: listing.market.currency } })) })), { headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(visible, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!canManageGlobalData(user.role)) return NextResponse.json({ error: "Only OWNER or ADMIN can create bundles" }, { status: 403 });
    const body = await request.json();
    if (!body.name?.trim() || !Array.isArray(body.items) || !body.items.length || !Array.isArray(body.listings) || !body.listings.length) return NextResponse.json({ error: "Name, components, and at least one market listing are required" }, { status: 400 });
    if (body.listings.some((listing: { marketCode?: unknown }) => typeof listing.marketCode !== "string" || !listing.marketCode.trim())) return NextResponse.json({ error: "Market code is required for every market listing." }, { status: 400 });
    const result = await prisma.$transaction(async (tx) => {
      const marketCodes = [...new Set<string>(body.listings.map((listing: { marketCode: string }) => listing.marketCode.trim()))];
      const markets = await tx.market.findMany({ where: { code: { in: marketCodes } } });
      const invalidMarketCode = marketCodes.find((code) => !markets.some((market) => market.code === code));
      if (invalidMarketCode) throw new Error(`Invalid market code: ${invalidMarketCode}`);
      for (const market of markets) if (!canAccessMarket(user, market.code)) throw new Error("MARKET_ACCESS_DENIED");
      for (const item of body.items) if (!Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0 || (!item.productId && !item.variantId)) throw new Error("Each component requires a product or variant and a positive integer quantity");
      for (const listing of body.listings) if (Number(listing.cost) < 0 || Number(listing.individualTotal) < 0 || Number(listing.price) < 0) throw new Error("Bundle amounts cannot be negative");
      return tx.bundle.create({ data: { name: body.name.trim(), status: (body.status || ProductStatus.DRAFT) as ProductStatus, items: { create: body.items.map((item: { productId?: string; variantId?: string; quantity: number }) => ({ productId: item.productId || null, variantId: item.variantId || null, quantity: Number(item.quantity) })) }, listings: { create: body.listings.map((listing: { marketCode: string; cost: number; individualTotal: number; price: number }) => ({ marketId: markets.find((market) => market.code === listing.marketCode.trim())!.id, cost: new Prisma.Decimal(listing.cost), individualTotal: new Prisma.Decimal(listing.individualTotal), price: new Prisma.Decimal(listing.price) })) } } });
    });
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (error) { const message = error instanceof Error ? error.message : "Bundle creation failed"; return NextResponse.json({ error: message === "MARKET_ACCESS_DENIED" ? "Market access denied" : message }, { status: message === "MARKET_ACCESS_DENIED" ? 403 : 400 }); }
}
