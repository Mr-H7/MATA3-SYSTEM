import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export async function GET(request: NextRequest) {
  try { await requireOwner(); } catch { return NextResponse.json({ error: "Not authorized" }, { status: 403 }); }
  const market = request.nextUrl.searchParams.get("market");
  if (market && market !== "EGYPT" && market !== "MOROCCO") return NextResponse.json({ error: "Invalid market" }, { status: 400 });
  const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
  if (!Number.isInteger(page) || page < 1 || page > 100000) return NextResponse.json({ error: "Invalid page" }, { status: 400 });
  try {
    const where = market ? { marketCode: market } : {};
    const [rows, total] = await Promise.all([
      prisma.storefrontOrder.findMany({ where, orderBy: { placedAt: "desc" }, skip: (page - 1) * 30, take: 30,
        select: { reference: true, marketCode: true, currency: true, status: true, paymentStatus: true, customerName: true, normalizedPhone: true, grandTotal: true, placedAt: true } }),
      prisma.storefrontOrder.count({ where }),
    ]);
    return NextResponse.json({ page, total, items: rows.map(row => ({
      reference: row.reference, market: row.marketCode, currency: row.currency, status: row.status,
      paymentStatus: row.paymentStatus, customerName: row.customerName, phone: row.normalizedPhone,
      grandTotal: { amountMinor: row.grandTotal.mul(100).toNumber(), currency: row.currency },
      placedAt: row.placedAt.toISOString(),
    })) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Orders unavailable" }, { status: 503 }); }
}
