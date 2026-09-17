import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { InventoryType, Prisma, type StorefrontOrder } from "@prisma/client";
import { checkoutConfiguration, currencyFor, decimalFromMinor, type CheckoutMarket } from "./checkout-config";
import { availableStock, resolveListingInventory } from "./inventory-source";
import { normalizeGuestPhone } from "./guest-phone";
import { quotePublicCartInTransaction, type QuoteRequestLine } from "./public-cart-quote";
import { prisma } from "./prisma";

export type GuestOrderInput = {
  market: CheckoutMarket; lines: QuoteRequestLine[]; idempotencyKey: string;
  customer: { fullName: string; phone: string; email?: string; region: string; city: string; address: string; addressNotes?: string };
  deliveryCode: string; paymentCode: string;
};
export class GuestOrderError extends Error {
  constructor(public code: "INVALID_INPUT" | "CHECKOUT_UNAVAILABLE" | "CART_CHANGED" | "CONFLICT" | "OUT_OF_STOCK", public status: number) { super(code); }
}
const clean = (value: string, max: number) => value.trim().replace(/\s+/g, " ").slice(0, max);
function secret() {
  const value = process.env.MATA3_CONFIRMATION_SECRET;
  if (!value || value.length < 32) throw new GuestOrderError("CHECKOUT_UNAVAILABLE", 503);
  return value;
}
function capability(order: Pick<StorefrontOrder, "reference" | "idempotencyKey">) {
  return createHmac("sha256", secret()).update(order.reference + ":" + order.idempotencyKey).digest("base64url");
}
function amount(value: Prisma.Decimal, currency: "EGP" | "MAD") {
  return { amountMinor: value.mul(100).toNumber(), currency };
}
const includeOrder = { lines: true } as const;
type OrderWithLines = Prisma.StorefrontOrderGetPayload<{ include: typeof includeOrder }>;
export function publicOrder(order: OrderWithLines) {
  const currency = currencyFor(order.marketCode as CheckoutMarket);
  return {
    version: 1 as const, reference: order.reference, market: order.marketCode, currency,
    status: order.status, paymentStatus: order.paymentStatus, placedAt: order.placedAt.toISOString(),
    customerName: order.customerName,
    address: { region: order.region, city: order.city, detailedAddress: order.address, ...(order.addressNotes ? { notes: order.addressNotes } : {}) },
    delivery: { code: order.deliveryCode, label: order.deliveryLabel, amount: amount(order.deliveryAmount, currency) },
    payment: { code: order.paymentCode, label: order.paymentLabel },
    itemsSubtotal: amount(order.itemsSubtotal, currency), adjustments: amount(order.adjustments, currency),
    grandTotal: amount(order.grandTotal, currency),
    lines: order.lines.map(line => ({ kind: line.kind, name: line.name, ...(line.variantLabel ? { variantLabel: line.variantLabel } : {}),
      attributes: line.attributes, quantity: line.quantity, unitPrice: amount(line.unitPrice, currency), lineTotal: amount(line.lineTotal, currency) })),
    availableCustomerActions: [] as string[],
  };
}
function reference(market: CheckoutMarket) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  return "MTA-" + (market === "EGYPT" ? "EG" : "MA") + "-" + [...bytes].map(byte => alphabet[byte % alphabet.length]).join("");
}
function normalized(input: GuestOrderInput) {
  if (!input || typeof input !== "object" || !["EGYPT", "MOROCCO"].includes(input.market) || !Array.isArray(input.lines) || !input.lines.length || input.lines.length > 50
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)
    || input.lines.some(line => typeof line.key !== "string" || !/^[a-f0-9-]{1,100}$/i.test(line.key)
      || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99
      || (line.observedUnitAmountMinor !== undefined && (!Number.isSafeInteger(line.observedUnitAmountMinor) || line.observedUnitAmountMinor < 0)))
    || !input.customer || typeof input.customer !== "object") throw new GuestOrderError("INVALID_INPUT", 400);
  const customer = input.customer;
  for (const value of [customer.fullName, customer.phone, customer.region, customer.city, customer.address])
    if (typeof value !== "string" || !value.trim()) throw new GuestOrderError("INVALID_INPUT", 400);
  if (typeof input.deliveryCode !== "string" || typeof input.paymentCode !== "string"
    || (customer.email !== undefined && typeof customer.email !== "string")
    || (customer.addressNotes !== undefined && typeof customer.addressNotes !== "string")) throw new GuestOrderError("INVALID_INPUT", 400);
  const phone = normalizeGuestPhone(input.market, customer.phone);
  const fullName = clean(customer.fullName, 120), region = clean(customer.region, 100), city = clean(customer.city, 100), address = clean(customer.address, 300);
  const email = customer.email?.trim().toLowerCase() || undefined;
  const addressNotes = customer.addressNotes?.trim().slice(0, 300) || undefined;
  if (!phone || fullName.length < 2 || region.length < 2 || city.length < 2 || address.length < 5
    || customer.fullName.length > 120 || customer.region.length > 100 || customer.city.length > 100 || customer.address.length > 300
    || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || (email?.length ?? 0) > 254
    || (customer.addressNotes?.length ?? 0) > 300) throw new GuestOrderError("INVALID_INPUT", 400);
  return { ...input, customer: { fullName, phone, region, city, address, ...(email ? { email } : {}), ...(addressNotes ? { addressNotes } : {}) } };
}
type Allocation = { inventoryId: string; sourceMarketCode: string; quantityPerOrderUnit: number };
type Stock = { previous: number; reserved: number; demand: number };
export async function createGuestOrder(raw: GuestOrderInput) {
  const input = normalized(raw), config = checkoutConfiguration(input.market);
  const delivery = config.deliveryMethods.find(item => item.code === input.deliveryCode);
  const payment = config.paymentMethods.find(item => item.code === input.paymentCode);
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const existing = await prisma.storefrontOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: includeOrder });
  if (existing) {
    if (existing.requestHash !== requestHash) throw new GuestOrderError("CONFLICT", 409);
    return { order: publicOrder(existing), confirmationToken: capability(existing), replayed: true };
  }
  if (!config.checkoutAvailable || !delivery || !payment) throw new GuestOrderError("CHECKOUT_UNAVAILABLE", 503);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const created = await prisma.$transaction(async tx => {
        const duplicate = await tx.storefrontOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: includeOrder });
        if (duplicate) {
          if (duplicate.requestHash !== requestHash) throw new GuestOrderError("CONFLICT", 409);
          return duplicate;
        }
        const market = await tx.market.findUnique({ where: { code: input.market } });
        if (!market || market.currency !== config.currency) throw new GuestOrderError("CHECKOUT_UNAVAILABLE", 503);
        const quote = await quotePublicCartInTransaction(tx, input.market, input.lines);
        if (!quote || !quote.canProceed) throw new GuestOrderError("CART_CHANGED", 409);
        const stock = new Map<string, Stock>();
        const lines: Array<{ kind: string; name: string; variantLabel?: string; attributes: Prisma.InputJsonValue; quantity: number; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal; allocations: Allocation[] }> = [];
        for (let index = 0; index < input.lines.length; index++) {
          const requested = input.lines[index], quoted = quote.lines[index];
          const allocations: Allocation[] = [];
          let attributes: Prisma.InputJsonValue = {};
          if (quoted.kind === "product") {
            const listing = await tx.marketListing.findUnique({ where: { publicOfferId: requested.key }, include: { product: true, variant: true, market: true, inventory: true } });
            if (!listing || listing.marketId !== market.id || listing.inventoryType !== InventoryType.PHYSICAL_STOCK) throw new GuestOrderError("CART_CHANGED", 409);
            const resolved = await resolveListingInventory(tx, listing);
            if (!resolved.inventory) throw new GuestOrderError("OUT_OF_STOCK", 409);
            allocations.push({ inventoryId: resolved.inventory.id, sourceMarketCode: resolved.inventorySourceMarketCode, quantityPerOrderUnit: 1 });
            attributes = { ...(listing.variant?.color ? { color: listing.variant.color } : {}), ...(listing.variant?.size ? { size: listing.variant.size } : {}) };
            const current = stock.get(resolved.inventory.id) ?? { previous: resolved.inventory.currentStock, reserved: resolved.inventory.reservedStock, demand: 0 };
            current.demand += requested.quantity; stock.set(resolved.inventory.id, current);
          } else {
            const listing = await tx.bundleMarketListing.findUnique({ where: { publicOfferId: requested.key }, include: { bundle: { include: { items: { include: { variant: true } } } } } });
            if (!listing || listing.marketId !== market.id || !listing.bundle.items.length) throw new GuestOrderError("CART_CHANGED", 409);
            const byInventory = new Map<string, Allocation>();
            for (const component of listing.bundle.items) {
              const productId = component.variantId ? component.variant?.productId : component.productId;
              if (!productId || component.quantity < 1) throw new GuestOrderError("CART_CHANGED", 409);
              const part = await tx.marketListing.findFirst({ where: { productId, variantId: component.variantId, marketId: market.id }, include: { product: true, variant: true, market: true, inventory: true } });
              if (!part || part.inventoryType !== InventoryType.PHYSICAL_STOCK) throw new GuestOrderError("CART_CHANGED", 409);
              const resolved = await resolveListingInventory(tx, part);
              if (!resolved.inventory) throw new GuestOrderError("OUT_OF_STOCK", 409);
              const allocation = byInventory.get(resolved.inventory.id);
              if (allocation) allocation.quantityPerOrderUnit += component.quantity;
              else byInventory.set(resolved.inventory.id, { inventoryId: resolved.inventory.id, sourceMarketCode: resolved.inventorySourceMarketCode, quantityPerOrderUnit: component.quantity });
              const current = stock.get(resolved.inventory.id) ?? { previous: resolved.inventory.currentStock, reserved: resolved.inventory.reservedStock, demand: 0 };
              current.demand += component.quantity * requested.quantity; stock.set(resolved.inventory.id, current);
            }
            allocations.push(...byInventory.values());
          }
          if (!quoted.unitPrice || !quoted.lineTotal || !quoted.name || !quoted.kind) throw new GuestOrderError("CART_CHANGED", 409);
          lines.push({ kind: quoted.kind, name: quoted.name, ...(quoted.label ? { variantLabel: quoted.label } : {}),
            attributes, quantity: requested.quantity, unitPrice: decimalFromMinor(quoted.unitPrice.amountMinor),
            lineTotal: decimalFromMinor(quoted.lineTotal.amountMinor), allocations });
        }
        const publicReference = reference(input.market);
        for (const [inventoryId, state] of stock) {
          if (state.demand > Math.max(0, state.previous - state.reserved)) throw new GuestOrderError("OUT_OF_STOCK", 409);
          const updated = await tx.inventory.updateMany({ where: { id: inventoryId, currentStock: state.previous, reservedStock: state.reserved }, data: { currentStock: { decrement: state.demand } } });
          if (updated.count !== 1) throw new GuestOrderError("OUT_OF_STOCK", 409);
          await tx.inventoryMovement.create({ data: { inventoryId, quantityChange: -state.demand, previousQuantity: state.previous, newQuantity: state.previous - state.demand, reason: "STOREFRONT_ORDER", reference: publicReference } });
        }
        const subtotal = decimalFromMinor(quote.itemsSubtotal.amountMinor), shipping = decimalFromMinor(delivery.amountMinor);
        return tx.storefrontOrder.create({ data: {
          reference: publicReference, idempotencyKey: input.idempotencyKey, requestHash,
          marketId: market.id, marketCode: market.code, currency: market.currency,
          customerName: input.customer.fullName, normalizedPhone: input.customer.phone, email: input.customer.email,
          region: input.customer.region, city: input.customer.city, address: input.customer.address, addressNotes: input.customer.addressNotes,
          deliveryCode: delivery.code, deliveryLabel: delivery.label, deliveryAmount: shipping,
          paymentCode: payment.code, paymentLabel: payment.label, itemsSubtotal: subtotal, grandTotal: subtotal.add(shipping),
          confirmationUntil: new Date(Date.now() + 15 * 60 * 1000),
          lines: { create: lines.map(line => ({ kind: line.kind, name: line.name, variantLabel: line.variantLabel, attributes: line.attributes,
            quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: line.lineTotal,
            allocations: { create: line.allocations } })) },
        }, include: includeOrder });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
      return { order: publicOrder(created), confirmationToken: capability(created), replayed: false };
    } catch (error) {
      if (error instanceof GuestOrderError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
        const found = await prisma.storefrontOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: includeOrder });
        if (found) {
          if (found.requestHash !== requestHash) throw new GuestOrderError("CONFLICT", 409);
          return { order: publicOrder(found), confirmationToken: capability(found), replayed: true };
        }
        if (error.code === "P2034") continue;
      }
      throw error;
    }
  }
  throw new GuestOrderError("OUT_OF_STOCK", 409);
}
export async function confirmGuestOrder(reference: string, token: string) {
  if (!/^MTA-(EG|MA)-[A-Z2-9]{12}$/.test(reference) || !/^[\w-]{40,100}$/.test(token)) return null;
  const order = await prisma.storefrontOrder.findUnique({ where: { reference }, include: includeOrder });
  if (!order || order.confirmationUntil.getTime() < Date.now()) return null;
  const expected = capability(order), a = Buffer.from(token), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? publicOrder(order) : null;
}
function publicTrackingOrder(order: OrderWithLines) {
  const snapshot = publicOrder(order);
  return { ...snapshot, customerName: undefined, address: { region: order.region, city: order.city } };
}
export async function trackGuestOrder(reference: string, phone: string, ip: string) {
  const now = new Date(), windowStart = new Date(Date.now() - 15 * 60 * 1000);
  const keys = [
    ...(ip && ip !== "unknown" ? [createHash("sha256").update("ip:" + ip).digest("hex")] : []),
    createHash("sha256").update("reference:" + reference).digest("hex"),
  ];
  for (const key of keys) {
    const current = await prisma.guestTrackingThrottle.findUnique({ where: { key } });
    if (!current || current.windowStart < windowStart) await prisma.guestTrackingThrottle.upsert({ where: { key }, create: { key, windowStart: now, attempts: 1 }, update: { windowStart: now, attempts: 1 } });
    else {
      if (current.attempts >= 10) return { limited: true as const, order: null };
      await prisma.guestTrackingThrottle.update({ where: { key }, data: { attempts: { increment: 1 } } });
    }
  }
  if (!/^MTA-(EG|MA)-[A-Z2-9]{12}$/.test(reference) || typeof phone !== "string") return { limited: false as const, order: null };
  const market = reference.startsWith("MTA-EG-") ? "EGYPT" : "MOROCCO";
  const normalizedPhone = normalizeGuestPhone(market, phone);
  if (!normalizedPhone) return { limited: false as const, order: null };
  const order = await prisma.storefrontOrder.findUnique({ where: { reference }, include: includeOrder });
  return { limited: false as const, order: order && order.normalizedPhone === normalizedPhone ? publicTrackingOrder(order) : null };
}
