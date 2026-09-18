import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { quotePublicCartInTransaction, type QuoteRequestLine } from "@/lib/public-cart-quote";
import { resolveShipping, ShippingUnavailable } from "@/lib/shipping";
import { prisma } from "@/lib/prisma";
export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 });
  const row = body as Record<string, unknown>;
  if ((row.market !== "EGYPT" && row.market !== "MOROCCO") || typeof row.destinationKey !== "string" ||
    typeof row.deliveryCode !== "string" || !Array.isArray(row.lines) || row.lines.length < 1 || row.lines.length > 50 ||
    row.lines.some(value => !value || typeof value !== "object" || Array.isArray(value) ||
      typeof value.key !== "string" || !/^[a-f0-9-]{1,100}$/i.test(value.key) ||
      !Number.isInteger(value.quantity) || value.quantity < 1 || value.quantity > 99 ||
      (value.observedUnitAmountMinor !== undefined && (!Number.isSafeInteger(value.observedUnitAmountMinor) || value.observedUnitAmountMinor < 0))))
    return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 });
  try {
    const { shipping, cart } = await prisma.$transaction(async tx => ({
      shipping: await resolveShipping(tx, row.market as "EGYPT" | "MOROCCO", row.destinationKey as string, row.deliveryCode as string),
      cart: await quotePublicCartInTransaction(tx, row.market as string, row.lines as QuoteRequestLine[]),
    }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    if (!cart) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 });
    const currency = cart.currency;
    const amount = shipping.tariff.amountMinor;
    return NextResponse.json({ version: 1, market: row.market, currency, cart,
      delivery: { code: shipping.method.code, label: shipping.method.label, amount: { amountMinor: amount, currency },
        pricingProvenance: "APPROVED_TARIFF" },
      itemsSubtotal: cart.itemsSubtotal,
      grandTotal: { amountMinor: cart.itemsSubtotal.amountMinor + amount, currency },
      canProceed: cart.canProceed,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ShippingUnavailable) return NextResponse.json({ code: error.code }, { status: 409, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ code: "CHECKOUT_QUOTE_ERROR" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
