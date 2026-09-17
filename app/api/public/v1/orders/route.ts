import { NextRequest, NextResponse } from "next/server";
import { createGuestOrder, GuestOrderError, type GuestOrderInput } from "@/lib/guest-order";
export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid order request" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid order request" }, { status: 400 });
  try {
    const result = await createGuestOrder(body as GuestOrderInput);
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    if (error instanceof GuestOrderError) return NextResponse.json({ code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ code: "ORDER_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
