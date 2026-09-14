import { NextRequest, NextResponse } from "next/server";
import { getPublicProducts } from "@/lib/public-catalogue";

const MARKETS = new Set(["EGYPT", "MOROCCO"]);

export async function GET(request: NextRequest) {
  const market = request.nextUrl.searchParams.get("market")?.toUpperCase() ?? "";
  if (!MARKETS.has(market)) return NextResponse.json({ error: "market query parameter must be EGYPT or MOROCCO" }, { status: 400 });
  const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
  const pageSize = Number(request.nextUrl.searchParams.get("pageSize") ?? "24");
  try {
    const payload = await getPublicProducts(market, page, pageSize);
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load public catalogue" }, { status: 400 });
  }
}
