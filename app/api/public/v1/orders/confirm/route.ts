import { NextRequest, NextResponse } from "next/server";
import { confirmGuestOrder } from "@/lib/guest-order";
export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const row = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  try {
    const order = await confirmGuestOrder(typeof row?.reference === "string" ? row.reference : "", typeof row?.token === "string" ? row.token : "");
    return order ? NextResponse.json(order, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }) : NextResponse.json({ error: "Confirmation unavailable" }, { status: 404 });
  } catch { return NextResponse.json({ error: "Confirmation unavailable" }, { status: 404 }); }
}
