import { Prisma } from "@prisma/client";
export type CheckoutMarket = "EGYPT" | "MOROCCO";
export type PublicMethod = { code: string; label: string };
export type PublicDelivery = PublicMethod & { amountMinor: number; currency: "EGP" | "MAD" };
const payments: Record<CheckoutMarket, PublicMethod[]> = {
  EGYPT: [
    { code: "BANK_TRANSFER", label: "Bank Transfer" },
    { code: "INSTAPAY", label: "InstaPay" },
    { code: "E_WALLET", label: "E-Wallet" },
    { code: "FAWRY", label: "Fawry" },
    { code: "CASH_ON_DELIVERY", label: "Cash on Delivery" },
  ],
  MOROCCO: [
    { code: "BANK_TRANSFER", label: "Bank Transfer" },
    { code: "CASH_ON_DELIVERY", label: "Cash on Delivery" },
  ],
};
export function currencyFor(market: CheckoutMarket): "EGP" | "MAD" { return market === "EGYPT" ? "EGP" : "MAD"; }
export function checkoutConfiguration(market: CheckoutMarket) {
  const currency = currencyFor(market);
  let delivery: PublicDelivery[] = [];
  try {
    const raw: unknown = JSON.parse(process.env.MATA3_DELIVERY_CONFIG_JSON ?? "[]");
    if (Array.isArray(raw)) delivery = raw.flatMap((item): PublicDelivery[] => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (row.market !== market || row.enabled !== true || typeof row.code !== "string" || !/^[A-Z0-9_]{2,40}$/.test(row.code)
        || typeof row.label !== "string" || !row.label.trim() || row.label.length > 100
        || !Number.isSafeInteger(row.amountMinor) || (row.amountMinor as number) < 0) return [];
      return [{ code: row.code, label: row.label.trim(), amountMinor: row.amountMinor as number, currency }];
    });
  } catch { /* unresolved configuration leaves checkout unavailable */ }
  const unique = new Set<string>();
  delivery = delivery.filter(item => !unique.has(item.code) && !!unique.add(item.code));
  return { version: 1 as const, market, currency, deliveryMethods: delivery, paymentMethods: payments[market], checkoutAvailable: delivery.length > 0 && (process.env.MATA3_CONFIRMATION_SECRET?.length ?? 0) >= 32 };
}
export function decimalFromMinor(minor: number) { return new Prisma.Decimal(minor).div(100); }
