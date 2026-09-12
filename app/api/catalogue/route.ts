import { NextRequest, NextResponse } from "next/server";
import { canAccessMarket, isSeller, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const user = await requireUser();
  const code = request.nextUrl.searchParams.get("market") || (user.marketScope === "ALL" ? "EGYPT" : user.marketScope);
  if (!canAccessMarket(user, code)) return NextResponse.json({ error: "Market access denied" }, { status: 403 });
  const where = { market: { code }, available: true, product: { status: "ACTIVE" as const } };
  if (isSeller(user)) {
    const rows = await prisma.marketListing.findMany({ where, select: { id: true, price: true, available: true, market: { select: { code: true, currency: true } }, product: { select: { id: true, sku: true, nameAr: true, nameEn: true, brand: true, model: true, category: { select: { name: true } } } }, variant: { select: { id: true, sku: true, color: true, size: true } }, inventory: { select: { currentStock: true, reservedStock: true } } }, orderBy: { product: { nameEn: "asc" } } });
    return NextResponse.json(rows.map((row) => ({ ...row, availableStock: Math.max(0, (row.inventory?.currentStock ?? 0) - (row.inventory?.reservedStock ?? 0)), inventory: undefined })), { headers: { "Cache-Control": "no-store" } });
  }
  const rows = await prisma.marketListing.findMany({ where, include: { product: true, variant: true, market: true, inventory: true }, orderBy: { product: { nameEn: "asc" } } });
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}
