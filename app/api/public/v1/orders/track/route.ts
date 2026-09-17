import { NextRequest, NextResponse } from "next/server";
import { trackGuestOrder } from "@/lib/guest-order";
export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const row = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  const reference = typeof row?.reference === "string" ? row.reference.trim().toUpperCase().slice(0, 100) : "";
  const phone = typeof row?.phone === "string" ? row.phone.slice(0, 40) : "";
  const ip = request.headers.get("x-mata3-client-ip") || request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try {
    const result = await trackGuestOrder(reference, phone, ip);
    if (result.limited) return NextResponse.json({ error: "Unable to retrieve order" }, { status: 429, headers: { "Cache-Control": "no-store" } });
    return result.order ? NextResponse.json(result.order, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Unable to retrieve order" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Unable to retrieve order" }, { status: 404, headers: { "Cache-Control": "no-store" } }); }
}
