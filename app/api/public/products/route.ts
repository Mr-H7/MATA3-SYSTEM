import { NextRequest, NextResponse } from "next/server";
import { getPublicProducts } from "@/lib/public-catalogue";
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const market = params.get("market")?.toUpperCase() ?? "";
  if (market !== "EGYPT" && market !== "MOROCCO") return NextResponse.json({ error: "Invalid market" }, { status: 400 });
  const page = Number(params.get("page") ?? "1"), pageSize = Number(params.get("pageSize") ?? "24");
  if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 48) return NextResponse.json({ error: "Invalid pagination" }, { status: 400 });
  const category = params.get("category") || undefined, query = params.get("q")?.trim() || undefined;
  if ((category && category.length > 100) || (query && query.length > 100)) return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
  try {
    const payload = await getPublicProducts(market, page, pageSize, category, query);
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, s-maxage=60" } });
  } catch {
    return NextResponse.json({ error: "Unable to load catalogue" }, { status: 500 });
  }
}
