import { NextResponse } from "next/server";
import { getPublicMarkets } from "@/lib/public-catalogue";
export async function GET() {
  try { return NextResponse.json(await getPublicMarkets(), { headers: { "Cache-Control": "public, s-maxage=300" } }); }
  catch { return NextResponse.json({ error: "Unable to load markets" }, { status: 500 }); }
}
