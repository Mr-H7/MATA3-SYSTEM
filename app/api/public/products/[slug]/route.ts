import { NextRequest, NextResponse } from "next/server";
import { getPublicProductBySlug } from "@/lib/public-catalogue";
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const market = request.nextUrl.searchParams.get("market")?.toUpperCase() ?? "";
  if (market !== "EGYPT" && market !== "MOROCCO") return NextResponse.json({ error: "Invalid market" }, { status: 400 });
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  try {
    const payload = await getPublicProductBySlug(market, slug);
    return payload ? NextResponse.json(payload, { headers: { "Cache-Control": "public, s-maxage=60" } }) : NextResponse.json({ error: "Product not found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Unable to load product" }, { status: 500 });
  }
}
