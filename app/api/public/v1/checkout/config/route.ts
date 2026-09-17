import { NextRequest, NextResponse } from "next/server";
import { checkoutConfiguration } from "@/lib/checkout-config";
export async function GET(request: NextRequest) {
  const market = request.nextUrl.searchParams.get("market")?.toUpperCase();
  if (market !== "EGYPT" && market !== "MOROCCO") return NextResponse.json({ error: "Invalid market" }, { status: 400 });
  return NextResponse.json(checkoutConfiguration(market), { headers: { "Cache-Control": "no-store" } });
}
