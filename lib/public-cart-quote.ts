import { InventoryType, Prisma, WebPublicationStatus } from "@prisma/client";
import { availableStock, resolveListingInventory } from "./inventory-source";
import { exactMoney, type PublicMoney } from "./public-catalogue";
import { prisma } from "./prisma";

export type QuoteCode =
  | "INVALID_KEY" | "INVALID_QUANTITY" | "WRONG_MARKET" | "NOT_PUBLIC"
  | "UNAVAILABLE" | "BUNDLE_UNAVAILABLE" | "INSUFFICIENT_STOCK" | "PRICE_CHANGED";
export type QuoteRequestLine = { key: string; quantity: number; observedUnitAmountMinor?: number };
export type PublicQuoteLine = {
  key: string;
  quantity: number;
  valid: boolean;
  codes: QuoteCode[];
  kind?: "product" | "bundle";
  slug?: string;
  name?: string;
  label?: string;
  unitPrice?: PublicMoney;
  lineTotal?: PublicMoney;
};
export type PublicCartQuote = {
  version: 1;
  market: "EGYPT" | "MOROCCO";
  currency: "EGP" | "MAD";
  lines: PublicQuoteLine[];
  itemsSubtotal: PublicMoney;
  canProceed: boolean;
  reservation: false;
};
type WorkLine = PublicQuoteLine & { demand: Map<string, number> };
type InventoryState = { available: number };
const productListingInclude = { product: true, variant: true, market: true, inventory: true } as const;
type ProductListing = Prisma.MarketListingGetPayload<{ include: typeof productListingInclude }>;

function addDemand(demand: Map<string, number>, id: string, quantity: number) {
  demand.set(id, (demand.get(id) ?? 0) + quantity);
}
async function inventoryFor(tx: Prisma.TransactionClient, listing: ProductListing) {
  if (!listing.available || listing.inventoryType !== InventoryType.PHYSICAL_STOCK) return null;
  try { return (await resolveListingInventory(tx, listing)).inventory; }
  catch { return null; }
}
function baseLine(input: QuoteRequestLine): WorkLine {
  return { key: input.key, quantity: Number.isInteger(input.quantity) ? input.quantity : 0, valid: false, codes: [], demand: new Map() };
}
function setPrice(line: WorkLine, price: Prisma.Decimal, market: string, observed?: number) {
  const unitPrice = exactMoney(price, market);
  line.unitPrice = unitPrice;
  line.lineTotal = { amountMinor: unitPrice.amountMinor * line.quantity, currency: unitPrice.currency };
  if (observed !== undefined && observed !== unitPrice.amountMinor) line.codes.push("PRICE_CHANGED");
}
async function quoteProduct(tx: Prisma.TransactionClient, line: WorkLine, listing: ProductListing, marketId: string, observed?: number) {
  if (listing.marketId !== marketId) { line.codes.push("WRONG_MARKET"); return; }
  if (listing.product.status !== "ACTIVE" || !listing.product.publicSlug || listing.webPublicationStatus !== WebPublicationStatus.PUBLISHED) {
    line.codes.push("NOT_PUBLIC"); return;
  }
  line.kind = "product";
  line.slug = listing.product.publicSlug;
  line.name = listing.product.nameEn;
  line.label = [listing.variant?.color, listing.variant?.size].filter(Boolean).join(" / ") || "Standard";
  setPrice(line, listing.price, listing.market.code, observed);
  const inventory = await inventoryFor(tx, listing);
  if (!inventory) { line.codes.push("UNAVAILABLE"); return; }
  addDemand(line.demand, inventory.id, line.quantity);
}
async function quoteBundle(
  tx: Prisma.TransactionClient, line: WorkLine,
  listing: Prisma.BundleMarketListingGetPayload<{ include: { bundle: { include: { items: { include: { variant: true } } } }; market: true } }>,
  marketId: string, observed?: number,
) {
  if (listing.marketId !== marketId) { line.codes.push("WRONG_MARKET"); return; }
  if (listing.bundle.status !== "ACTIVE" || !listing.bundle.publicSlug || listing.webPublicationStatus !== WebPublicationStatus.PUBLISHED) {
    line.codes.push("NOT_PUBLIC"); return;
  }
  line.kind = "bundle";
  line.slug = listing.bundle.publicSlug;
  line.name = listing.bundle.name;
  setPrice(line, listing.price, listing.market.code, observed);
  if (!listing.bundle.items.length) { line.codes.push("BUNDLE_UNAVAILABLE"); return; }
  const componentDemand = new Map<string, number>();
  for (const component of listing.bundle.items) {
    const productId = component.variantId ? component.variant?.productId : component.productId;
    if (!productId || component.quantity < 1 || (component.productId && component.variantId && component.productId !== component.variant?.productId)) {
      line.codes.push("BUNDLE_UNAVAILABLE"); return;
    }
    const part = await tx.marketListing.findFirst({
      where: { productId, variantId: component.variantId, marketId },
      include: productListingInclude,
    });
    if (!part || part.product.status !== "ACTIVE" || !part.product.publicSlug || part.webPublicationStatus !== WebPublicationStatus.PUBLISHED) {
      line.codes.push("BUNDLE_UNAVAILABLE"); return;
    }
    const inventory = await inventoryFor(tx, part);
    if (!inventory) { line.codes.push("BUNDLE_UNAVAILABLE"); return; }
    addDemand(componentDemand, inventory.id, component.quantity * line.quantity);
  }
  line.demand = componentDemand;
}
export async function quotePublicCartInTransaction(tx: Prisma.TransactionClient, marketCode: string, inputs: QuoteRequestLine[]): Promise<PublicCartQuote | null> {
  if (marketCode !== "EGYPT" && marketCode !== "MOROCCO") return null;
  {
    const market = await tx.market.findUnique({ where: { code: marketCode } });
    const currency = marketCode === "EGYPT" ? "EGP" : "MAD";
    if (!market || market.currency !== currency) return null;
    const lines: WorkLine[] = [];
    const states = new Map<string, InventoryState>();
    for (const input of inputs) {
      const line = baseLine(input);
      lines.push(line);
      if (typeof input.key !== "string" || !/^[a-f0-9-]{1,100}$/i.test(input.key)) { line.codes.push("INVALID_KEY"); continue; }
      if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 99) { line.codes.push("INVALID_QUANTITY"); continue; }
      const product = await tx.marketListing.findUnique({ where: { publicOfferId: input.key }, include: productListingInclude });
      if (product) await quoteProduct(tx, line, product, market.id, input.observedUnitAmountMinor);
      else {
        const bundle = await tx.bundleMarketListing.findUnique({
          where: { publicOfferId: input.key },
          include: { bundle: { include: { items: { include: { variant: true } } } }, market: true },
        });
        if (bundle) await quoteBundle(tx, line, bundle, market.id, input.observedUnitAmountMinor);
        else line.codes.push("INVALID_KEY");
      }
      for (const inventoryId of line.demand.keys()) {
        if (!states.has(inventoryId)) {
          const inventory = await tx.inventory.findUnique({ where: { id: inventoryId } });
          states.set(inventoryId, { available: availableStock(inventory) });
        }
      }
    }
    const totalDemand = new Map<string, number>();
    for (const line of lines) for (const [id, quantity] of line.demand) addDemand(totalDemand, id, quantity);
    const shortIds = new Set([...totalDemand].filter(([id, quantity]) => quantity > (states.get(id)?.available ?? 0)).map(([id]) => id));
    for (const line of lines) {
      if ([...line.demand.keys()].some(id => shortIds.has(id))) line.codes.push(line.kind === "bundle" ? "BUNDLE_UNAVAILABLE" : "INSUFFICIENT_STOCK");
      line.valid = line.codes.length === 0;
    }
    const publicLines: PublicQuoteLine[] = lines.map(({ demand: _demand, ...line }) => line);
    const itemsSubtotal: PublicMoney = {
      amountMinor: publicLines.reduce((sum, line) => sum + (line.valid ? line.lineTotal?.amountMinor ?? 0 : 0), 0),
      currency,
    };
    return {
      version: 1, market: marketCode, currency, lines: publicLines, itemsSubtotal,
      canProceed: publicLines.length > 0 && publicLines.every(line => line.valid), reservation: false,
    };
  }
}
export async function quotePublicCart(marketCode: string, inputs: QuoteRequestLine[]): Promise<PublicCartQuote | null> {
  return prisma.$transaction(tx => quotePublicCartInTransaction(tx, marketCode, inputs), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
