import { NextRequest, NextResponse } from "next/server";
import { checkoutConfiguration } from "@/lib/checkout-config";
export async function GET(request: NextRequest) {
  const market = request.nextUrl.searchParams.get("market")?.toUpperCase();
  const destinationKey = request.nextUrl.searchParams.get("destinationKey") ?? undefined;
  if (market !== "EGYPT" && market !== "MOROCCO") return NextResponse.json({ code: "INVALID_MARKET" }, { status: 400 });
  try { return NextResponse.json(await checkoutConfiguration(market, destinationKey), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ code: "CHECKOUT_CONFIG_ERROR" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
