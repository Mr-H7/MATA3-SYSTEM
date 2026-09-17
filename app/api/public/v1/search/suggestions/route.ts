import { NextRequest, NextResponse } from "next/server";
import { publicSuggestions } from "@/lib/public-search";
export async function GET(request: NextRequest) {
  const market = request.nextUrl.searchParams.get("market")?.toUpperCase() ?? "";
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if ((market !== "EGYPT" && market !== "MOROCCO") || q.length > 100) return NextResponse.json({ error: "Invalid suggestions request" }, { status: 400 });
  try {
    const payload = await publicSuggestions(market, q);
    return payload ? NextResponse.json(payload, { headers: { "Cache-Control": "public, s-maxage=30" } }) : NextResponse.json({ error: "Invalid market" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Unable to load suggestions" }, { status: 500 });
  }
}
