import { Prisma, ShippingProvider, type ShippingDestination } from "@prisma/client";
import { prisma } from "./prisma";

export type ShippingMarket = "EGYPT" | "MOROCCO";
export const providerFor = (market: ShippingMarket): ShippingProvider => market === "EGYPT" ? "BOSTA" : "OZONEXPRESS";
export const currencyForShipping = (market: ShippingMarket): "EGP" | "MAD" => market === "EGYPT" ? "EGP" : "MAD";
const secretReady = () => (process.env.MATA3_CONFIRMATION_SECRET?.length ?? 0) >= 32;
type Db = Prisma.TransactionClient | typeof prisma;

export class ShippingUnavailable extends Error {
  constructor(public code: "DESTINATION_UNAVAILABLE" | "DELIVERY_UNAVAILABLE" | "CHECKOUT_UNAVAILABLE") { super(code); }
}

export async function destinationPath(db: Db, marketId: string, key: string) {
  if (typeof key !== "string" || !/^[a-f0-9-]{36}$/i.test(key)) throw new ShippingUnavailable("DESTINATION_UNAVAILABLE");
  const leaf = await db.shippingDestination.findUnique({ where: { publicKey: key } });
  if (!leaf || leaf.marketId !== marketId || !leaf.active) throw new ShippingUnavailable("DESTINATION_UNAVAILABLE");
  const path: ShippingDestination[] = [leaf];
  let current = leaf;
  for (let depth = 0; current.parentId; depth++) {
    if (depth > 5) throw new ShippingUnavailable("DESTINATION_UNAVAILABLE");
    const parent: ShippingDestination | null = await db.shippingDestination.findUnique({ where: { id: current.parentId } });
    if (!parent || !parent.active || parent.marketId !== marketId || path.some(item => item.id === parent.id)) throw new ShippingUnavailable("DESTINATION_UNAVAILABLE");
    path.unshift(parent); current = parent;
  }
  return path;
}

export async function resolveShipping(db: Db, market: ShippingMarket, destinationKey: string, methodCode: string, now = new Date()) {
  const marketRow = await db.market.findUnique({ where: { code: market }, include: { shippingConfiguration: true } });
  if (!marketRow || marketRow.currency !== currencyForShipping(market) || !marketRow.shippingConfiguration?.enabled || !secretReady())
    throw new ShippingUnavailable("CHECKOUT_UNAVAILABLE");
  const path = await destinationPath(db, marketRow.id, destinationKey);
  if (path[path.length - 1].kind === "REGION") throw new ShippingUnavailable("DESTINATION_UNAVAILABLE");
  const method = await db.shippingMethod.findUnique({ where: { marketId_code: { marketId: marketRow.id, code: methodCode } } });
  if (!method || !method.active || method.provider !== providerFor(market)) throw new ShippingUnavailable("DELIVERY_UNAVAILABLE");
  const tariffs = await db.shippingTariff.findMany({ where: {
    marketId: marketRow.id, methodId: method.id, active: true, currency: marketRow.currency,
    provenance: "APPROVED_TARIFF", packageClass: null,
    effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
  } });
  const ids = path.map(item => item.id);
  const candidates = tariffs.map(tariff => {
    const pathIndex = tariff.destinationId ? ids.indexOf(tariff.destinationId) : -1;
    const groupMatch = !tariff.destinationId && tariff.destinationGroupCode && path.some(item => item.tariffGroupCode === tariff.destinationGroupCode);
    return { tariff, priority: pathIndex >= 0 ? 100 + pathIndex : groupMatch ? 1 : -1 };
  }).filter(row => row.priority >= 0).sort((a, b) => b.priority - a.priority);
  if (!candidates.length || candidates.filter(row => row.priority === candidates[0].priority).length !== 1)
    throw new ShippingUnavailable("DELIVERY_UNAVAILABLE");
  return { market: marketRow, path, method, tariff: candidates[0].tariff };
}

export function publicDestination(path: ShippingDestination[]) {
  return path.map(item => ({ key: item.publicKey, name: item.name, kind: item.kind }));
}

export async function checkoutConfiguration(market: ShippingMarket, destinationKey?: string) {
  const marketRow = await prisma.market.findUnique({ where: { code: market }, include: { shippingConfiguration: true } });
  const currency = currencyForShipping(market);
  const destinations = marketRow ? await prisma.shippingDestination.findMany({
    where: { marketId: marketRow.id, active: true }, orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: { publicKey: true, parentId: true, kind: true, name: true, id: true },
  }) : [];
  const byId = new Map(destinations.map(row => [row.id, row]));
  const visible = destinations.filter(row => {
    let current = row;
    const seen = new Set<string>();
    while (current.parentId) {
      if (seen.has(current.id)) return false;
      seen.add(current.id);
      const parent = byId.get(current.parentId);
      if (!parent) return false;
      current = parent;
    }
    return true;
  });
  const publicDestinations = visible.map(row => ({
    key: row.publicKey, parentKey: visible.find(parent => parent.id === row.parentId)?.publicKey ?? null,
    kind: row.kind, name: row.name,
  }));
  const configured = !!marketRow?.shippingConfiguration?.enabled && secretReady();
  const methods = configured && destinationKey ? await prisma.shippingMethod.findMany({
    where: { marketId: marketRow.id, active: true, provider: providerFor(market) },
  }) : [];
  const deliveryMethods = [];
  for (const method of methods) {
    try {
      const resolved = await resolveShipping(prisma, market, destinationKey!, method.code);
      deliveryMethods.push({ code: method.code, label: method.label, amountMinor: resolved.tariff.amountMinor,
        currency, pricingProvenance: "APPROVED_TARIFF" as const });
    } catch (error) { if (!(error instanceof ShippingUnavailable)) throw error; }
  }
  return { version: 2 as const, market, currency, destinations: publicDestinations, deliveryMethods,
    checkoutAvailable: configured && deliveryMethods.length > 0,
    shippingStatus: !configured ? "NOT_CONFIGURED" as const : !destinationKey || !deliveryMethods.length ? "UNAVAILABLE" as const : "AVAILABLE" as const,
  };
}
