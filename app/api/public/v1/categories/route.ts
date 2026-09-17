import { NextRequest, NextResponse } from "next/server";
import { getPublicCategories } from "@/lib/public-catalogue";
export async function GET(request: NextRequest) {
  const market = request.nextUrl.searchParams.get("market")?.toUpperCase() ?? "";
  if (market !== "EGYPT" && market !== "MOROCCO") return NextResponse.json({ error: "Invalid market" }, { status: 400 });
  try {
    const payload = await getPublicCategories(market);
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, s-maxage=60" } });
  } catch { return NextResponse.json({ error: "Unable to load categories" }, { status: 500 }); }
}
