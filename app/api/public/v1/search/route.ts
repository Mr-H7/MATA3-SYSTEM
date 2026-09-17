import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_SORTS, searchPublicCatalogue, type PublicSort } from "@/lib/public-search";
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const market = params.get("market")?.toUpperCase() ?? "";
  if (market !== "EGYPT" && market !== "MOROCCO") return NextResponse.json({ error: "Invalid market" }, { status: 400 });
  const q = params.get("q")?.trim() ?? "";
  const category = params.get("category") || undefined, color = params.get("color") || undefined, size = params.get("size") || undefined;
  if ([q, category, color, size].some(value => value && value.length > 100)) return NextResponse.json({ error: "Invalid search filter" }, { status: 400 });
  const page = Number(params.get("page") ?? "1"), pageSize = Number(params.get("pageSize") ?? "24");
  if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 48) return NextResponse.json({ error: "Invalid pagination" }, { status: 400 });
  const parsePrice = (key: string) => {
    const raw = params.get(key);
    if (raw === null || raw === "") return undefined;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const minPriceMinor = parsePrice("minPriceMinor"), maxPriceMinor = parsePrice("maxPriceMinor");
  if (minPriceMinor === null || maxPriceMinor === null || (minPriceMinor !== undefined && maxPriceMinor !== undefined && minPriceMinor > maxPriceMinor)) return NextResponse.json({ error: "Invalid price range" }, { status: 400 });
  const sortRaw = params.get("sort") ?? "name_asc";
  if (!PUBLIC_SORTS.includes(sortRaw as PublicSort)) return NextResponse.json({ error: "Unsupported sort" }, { status: 400 });
  try {
    const payload = await searchPublicCatalogue({
      market, q, page, pageSize, sort: sortRaw as PublicSort,
      ...(category ? { category } : {}), ...(color ? { color } : {}), ...(size ? { size } : {}),
      ...(minPriceMinor !== undefined ? { minPriceMinor } : {}), ...(maxPriceMinor !== undefined ? { maxPriceMinor } : {}),
    });
    return payload ? NextResponse.json(payload, { headers: { "Cache-Control": "public, s-maxage=30" } }) : NextResponse.json({ error: "Invalid market" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Unable to search catalogue" }, { status: 500 });
  }
}
