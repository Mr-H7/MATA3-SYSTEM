import { Prisma } from "@prisma/client";
import { checkoutConfiguration as shippingConfiguration, currencyForShipping, type ShippingMarket } from "./shipping";
export type CheckoutMarket = ShippingMarket;
export type PublicMethod = { code: string; label: string };
const payments: Record<CheckoutMarket, PublicMethod[]> = {
  EGYPT: [{ code: "BANK_TRANSFER", label: "Bank Transfer" }, { code: "INSTAPAY", label: "InstaPay" },
    { code: "E_WALLET", label: "E-Wallet" }, { code: "FAWRY", label: "Fawry" }, { code: "CASH_ON_DELIVERY", label: "Cash on Delivery" }],
  MOROCCO: [{ code: "BANK_TRANSFER", label: "Bank Transfer" }, { code: "CASH_ON_DELIVERY", label: "Cash on Delivery" }],
};
export const currencyFor = currencyForShipping;
export async function checkoutConfiguration(market: CheckoutMarket, destinationKey?: string) {
  return { ...(await shippingConfiguration(market, destinationKey)), paymentMethods: payments[market] };
}
export function decimalFromMinor(minor: number) { return new Prisma.Decimal(minor).div(100); }
