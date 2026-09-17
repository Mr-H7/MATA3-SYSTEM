import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { publicOrder } from "@/lib/guest-order";
import { prisma } from "@/lib/prisma";
export async function GET(_request: NextRequest, context: { params: Promise<{ reference: string }> }) {
  try { await requireOwner(); } catch { return NextResponse.json({ error: "Not authorized" }, { status: 403 }); }
  const { reference } = await context.params;
  try {
    const order = await prisma.storefrontOrder.findUnique({ where: { reference }, include: { lines: true } });
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    return NextResponse.json({ ...publicOrder(order), phone: order.normalizedPhone, ...(order.email ? { email: order.email } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Order unavailable" }, { status: 503 }); }
}
