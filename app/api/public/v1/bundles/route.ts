import { NextRequest, NextResponse } from "next/server";
import { getPublicBundles } from "@/lib/public-catalogue";
export async function GET(request: NextRequest) {
  const market = request.nextUrl.searchParams.get("market")?.toUpperCase() ?? "";
  if (market !== "EGYPT" && market !== "MOROCCO") return NextResponse.json({ error: "Invalid market" }, { status: 400 });
  const page = Number(request.nextUrl.searchParams.get("page") ?? "1"), pageSize = Number(request.nextUrl.searchParams.get("pageSize") ?? "24");
  if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 48) return NextResponse.json({ error: "Invalid pagination" }, { status: 400 });
  try { return NextResponse.json(await getPublicBundles(market, page, pageSize), { headers: { "Cache-Control": "public, s-maxage=60" } }); }
  catch { return NextResponse.json({ error: "Unable to load bundles" }, { status: 500 }); }
}
