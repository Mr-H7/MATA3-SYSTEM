import { NextResponse } from "next/server";
import { quotePublicCart, type QuoteRequestLine } from "@/lib/public-cart-quote";
export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid quote request" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid quote request" }, { status: 400 });
  const input = body as { market?: unknown; lines?: unknown };
  if ((input.market !== "EGYPT" && input.market !== "MOROCCO") || !Array.isArray(input.lines) || input.lines.length > 50) {
    return NextResponse.json({ error: "Invalid quote request" }, { status: 400 });
  }
  const lines: QuoteRequestLine[] = [];
  for (const value of input.lines) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return NextResponse.json({ error: "Invalid quote request" }, { status: 400 });
    const row = value as Record<string, unknown>;
    if (typeof row.key !== "string" || row.key.length > 100 || typeof row.quantity !== "number") return NextResponse.json({ error: "Invalid quote request" }, { status: 400 });
    if (row.observedUnitAmountMinor !== undefined && (!Number.isSafeInteger(row.observedUnitAmountMinor) || (row.observedUnitAmountMinor as number) < 0)) return NextResponse.json({ error: "Invalid quote request" }, { status: 400 });
    lines.push({ key: row.key, quantity: row.quantity, ...(row.observedUnitAmountMinor !== undefined ? { observedUnitAmountMinor: row.observedUnitAmountMinor as number } : {}) });
  }
  try {
    const quote = await quotePublicCart(input.market, lines);
    return quote ? NextResponse.json(quote, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Invalid market" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Unable to quote cart" }, { status: 500 });
  }
}
