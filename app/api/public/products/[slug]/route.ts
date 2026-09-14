import { NextRequest, NextResponse } from "next/server";
import { getPublicProductBySlug } from "@/lib/public-catalogue";

const MARKETS = new Set(["EGYPT", "MOROCCO"]);

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const market = request.nextUrl.searchParams.get("market")?.toUpperCase() ?? "";
  if (!MARKETS.has(market)) return NextResponse.json({ error: "market query parameter must be EGYPT or MOROCCO" }, { status: 400 });
  const { slug } = await params;
  try {
    const product = await getPublicProductBySlug(market, slug);
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    return NextResponse.json(product, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load product" }, { status: 400 });
  }
}
