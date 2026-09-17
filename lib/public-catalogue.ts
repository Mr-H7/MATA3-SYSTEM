import { InventoryType, Prisma, WebPublicationStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { availableStock, resolveListingInventory } from "./inventory-source";

export type PublicMoney = { amountMinor: number; currency: "EGP" | "MAD" };
export type PublicMarket = { code: "EGYPT" | "MOROCCO"; currency: "EGP" | "MAD"; locales: string[] };
export type PublicCategory = { key: string; name: string; department: string };
export type PublicProductMedia = { type: "IMAGE" | "VIDEO"; url: string; altText: string; isCover: boolean; sortOrder: number };
export type PublicOffer = { offerId: string; label: string; attributes: { color?: string; size?: string }; price: PublicMoney; purchasable: boolean; media: PublicProductMedia[] };
export type PublicProductCard = { kind: "product"; slug: string; nameAr: string; nameEn: string; category?: PublicCategory; price: PublicMoney; purchasable: boolean; cover?: PublicProductMedia };
export type PublicProductDetail = PublicProductCard & { descriptionAr?: string; descriptionEn?: string; media: PublicProductMedia[]; offers: PublicOffer[] };
export type PublicBundle = { kind: "bundle"; slug: string; name: string; price: PublicMoney; purchasable: boolean; media: PublicProductMedia[]; components: { name: string; quantity: number }[]; offerId: string };
export type PublicPage<T> = { version: 1; market: "EGYPT" | "MOROCCO"; page: number; pageSize: number; total: number; items: T[] };

const productInclude = {
  category: { include: { department: true } },
  webMedia: { where: { publicationStatus: WebPublicationStatus.PUBLISHED }, orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }, { id: "asc" }] },
  listings: { where: { webPublicationStatus: WebPublicationStatus.PUBLISHED }, include: { variant: { include: { webMedia: { where: { publicationStatus: WebPublicationStatus.PUBLISHED }, orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }, { id: "asc" }] } } }, market: true, inventory: true } },
} as const satisfies Prisma.ProductInclude;
type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;
type ListingRow = ProductRow["listings"][number];
type MediaRow = ProductRow["webMedia"][number];

function marketCode(code: string): "EGYPT" | "MOROCCO" | null { return code === "EGYPT" || code === "MOROCCO" ? code : null; }
function currency(code: string): "EGP" | "MAD" { return code === "EGYPT" ? "EGP" : "MAD"; }
export function exactMoney(value: Prisma.Decimal, code: string): PublicMoney {
  const fixed = value.toFixed(2);
  const [whole, cents] = fixed.split(".");
  return { amountMinor: Number(whole) * 100 + Number(cents), currency: currency(code) };
}
function media(rows: MediaRow[]): PublicProductMedia[] {
  return rows.map(row => ({ type: row.type, url: row.url, altText: row.altText, isCover: row.isCover, sortOrder: row.sortOrder }));
}
function category(product: ProductRow): PublicCategory | undefined {
  const row = product.category;
  return row && !row.archived ? { key: row.publicKey, name: row.name, department: row.department.name } : undefined;
}
async function eligible(listing: ListingRow): Promise<boolean> {
  if (!listing.available || listing.inventoryType !== InventoryType.PHYSICAL_STOCK) return false;
  try { return availableStock((await resolveListingInventory(prisma, listing)).inventory) > 0; }
  catch { return false; }
}
async function offer(listing: ListingRow, productMedia: PublicProductMedia[]): Promise<PublicOffer> {
  const variant = listing.variant;
  const attributes = { ...(variant?.color ? { color: variant.color } : {}), ...(variant?.size ? { size: variant.size } : {}) };
  const variantMedia = variant ? media(variant.webMedia) : [];
  return {
    offerId: listing.publicOfferId,
    label: [variant?.color, variant?.size].filter(Boolean).join(" / ") || "Standard",
    attributes,
    price: exactMoney(listing.price, listing.market.code),
    purchasable: await eligible(listing),
    media: variantMedia.length ? [...variantMedia, ...productMedia.filter(item => !item.isCover)] : productMedia,
  };
}
function visibleListing(product: ProductRow, marketId: string) { return product.listings.filter(item => item.marketId === marketId); }
function card(product: ProductRow, offers: PublicOffer[]): PublicProductCard {
  const allMedia = media(product.webMedia);
  const pricedOffers = offers.some(item => item.purchasable) ? offers.filter(item => item.purchasable) : offers;
  const first = pricedOffers[0];
  return {
    kind: "product", slug: product.publicSlug!, nameAr: product.nameAr, nameEn: product.nameEn,
    ...(category(product) ? { category: category(product) } : {}),
    price: pricedOffers.reduce((min, item) => item.price.amountMinor < min.amountMinor ? item.price : min, first.price),
    purchasable: offers.some(item => item.purchasable),
    ...(allMedia[0] ? { cover: allMedia[0] } : first.media[0] ? { cover: first.media[0] } : {}),
  };
}
export async function getPublicMarkets(): Promise<{ version: 1; items: PublicMarket[] }> {
  const rows = await prisma.market.findMany({ where: { code: { in: ["EGYPT", "MOROCCO"] } }, select: { code: true, currency: true } });
  return { version: 1, items: rows.filter(row => row.currency === currency(row.code)).map(row => ({
    code: row.code as PublicMarket["code"], currency: row.currency as PublicMoney["currency"], locales: row.code === "EGYPT" ? ["ar", "en"] : ["ar", "fr", "en"],
  })) };
}
async function getMarket(code: string) {
  const normalized = marketCode(code);
  if (!normalized) return null;
  const row = await prisma.market.findUnique({ where: { code: normalized } });
  return row && row.currency === currency(normalized) ? row : null;
}
export async function getPublicCategories(code: string): Promise<{ version: 1; market: string; items: PublicCategory[] } | null> {
  const market = await getMarket(code); if (!market) return null;
  const rows = await prisma.category.findMany({
    where: { archived: false, products: { some: { status: "ACTIVE", publicSlug: { not: null }, listings: { some: { marketId: market.id, webPublicationStatus: "PUBLISHED" } } } } },
    include: { department: true }, orderBy: { name: "asc" },
  });
  return { version: 1, market: market.code, items: rows.map(row => ({ key: row.publicKey, name: row.name, department: row.department.name })) };
}
export async function getPublicProducts(code: string, page = 1, pageSize = 24, categoryKey?: string, query?: string): Promise<PublicPage<PublicProductCard> | null> {
  const market = await getMarket(code); if (!market) return null;
  const take = Math.min(48, Math.max(1, pageSize)), current = Math.max(1, page);
  const where: Prisma.ProductWhereInput = {
    status: "ACTIVE", publicSlug: { not: null },
    listings: { some: { marketId: market.id, webPublicationStatus: "PUBLISHED" } },
    ...(categoryKey ? { category: { publicKey: categoryKey, archived: false } } : {}),
    ...(query ? { OR: [{ nameEn: { contains: query, mode: "insensitive" } }, { nameAr: { contains: query, mode: "insensitive" } }] } : {}),
  };
  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({ where, include: productInclude, orderBy: [{ nameEn: "asc" }, { id: "asc" }], skip: (current - 1) * take, take }),
  ]);
  const items = await Promise.all(products.map(async product => {
    const offers = await Promise.all(visibleListing(product, market.id).map(item => offer(item, media(product.webMedia))));
    return card(product, offers);
  }));
  return { version: 1, market: market.code as PublicPage<PublicProductCard>["market"], page: current, pageSize: take, total, items };
}
export async function getPublicProductBySlug(code: string, slug: string): Promise<PublicProductDetail | null> {
  const market = await getMarket(code); if (!market) return null;
  const product = await prisma.product.findFirst({
    where: { publicSlug: slug, status: "ACTIVE", listings: { some: { marketId: market.id, webPublicationStatus: "PUBLISHED" } } }, include: productInclude,
  });
  if (!product) return null;
  const baseMedia = media(product.webMedia);
  const offers = await Promise.all(visibleListing(product, market.id).map(item => offer(item, baseMedia)));
  if (!offers.length) return null;
  return {
    ...card(product, offers), ...(product.descriptionAr ? { descriptionAr: product.descriptionAr } : {}),
    ...(product.descriptionEn ? { descriptionEn: product.descriptionEn } : {}),
    media: baseMedia, offers,
  };
}
const bundleInclude = {
  items: { include: { product: true, variant: { include: { product: true } } } },
  webMedia: { where: { publicationStatus: WebPublicationStatus.PUBLISHED }, orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }, { id: "asc" }] },
  listings: { where: { webPublicationStatus: WebPublicationStatus.PUBLISHED }, include: { market: true } },
} as const satisfies Prisma.BundleInclude;
type BundleRow = Prisma.BundleGetPayload<{ include: typeof bundleInclude }>;
async function bundleEligible(bundle: BundleRow, marketId: string): Promise<boolean> {
  if (!bundle.items.length || bundle.items.some(item => item.quantity < 1)) return false;
  const needed = new Map<string, { listing: ListingRow; quantity: number }>();
  for (const item of bundle.items) {
    const productId = item.productId ?? item.variant?.productId;
    if (!productId) return false;
    const product = await prisma.product.findFirst({ where: { id: productId, status: "ACTIVE", publicSlug: { not: null } }, include: productInclude });
    if (!product) return false;
    const listing = product.listings.find(row => row.marketId === marketId && row.variantId === item.variantId);
    if (!listing || !listing.available || listing.inventoryType !== InventoryType.PHYSICAL_STOCK) return false;
    const existing = needed.get(listing.id);
    needed.set(listing.id, { listing, quantity: (existing?.quantity ?? 0) + item.quantity });
  }
  for (const { listing, quantity } of needed.values()) {
    try { if (availableStock((await resolveListingInventory(prisma, listing)).inventory) < quantity) return false; }
    catch { return false; }
  }
  return true;
}
async function publicBundle(bundle: BundleRow, marketId: string): Promise<PublicBundle | null> {
  const listing = bundle.listings.find(row => row.marketId === marketId);
  if (!listing || !bundle.publicSlug || !bundle.items.length) return null;
  for (const item of bundle.items) {
    const productId = item.productId ?? item.variant?.productId;
    if (!productId || item.quantity < 1) return null;
    const visible = await prisma.product.count({ where: {
      id: productId, status: "ACTIVE", publicSlug: { not: null },
      listings: { some: { marketId, variantId: item.variantId, webPublicationStatus: "PUBLISHED" } },
    } });
    if (!visible) return null;
  }
  return {
    kind: "bundle", slug: bundle.publicSlug, name: bundle.name, offerId: listing.publicOfferId,
    price: exactMoney(listing.price, listing.market.code), purchasable: await bundleEligible(bundle, marketId),
    media: media(bundle.webMedia),
    components: bundle.items.map(item => ({ name: item.product?.nameEn ?? item.variant?.product.nameEn ?? "", quantity: item.quantity })),
  };
}
export async function getPublicBundles(code: string, page = 1, pageSize = 24): Promise<PublicPage<PublicBundle> | null> {
  const market = await getMarket(code); if (!market) return null;
  const take = Math.min(48, Math.max(1, pageSize)), current = Math.max(1, page);
  const where: Prisma.BundleWhereInput = { status: "ACTIVE", publicSlug: { not: null }, listings: { some: { marketId: market.id, webPublicationStatus: "PUBLISHED" } } };
  const rows = await prisma.bundle.findMany({ where, include: bundleInclude, orderBy: [{ name: "asc" }, { id: "asc" }] });
  const visible = (await Promise.all(rows.map(row => publicBundle(row, market.id)))).filter((item): item is PublicBundle => !!item);
  return { version: 1, market: market.code as PublicPage<PublicBundle>["market"], page: current, pageSize: take, total: visible.length, items: visible.slice((current - 1) * take, current * take) };
}
export async function getPublicBundleBySlug(code: string, slug: string): Promise<PublicBundle | null> {
  const market = await getMarket(code); if (!market) return null;
  const row = await prisma.bundle.findFirst({ where: { publicSlug: slug, status: "ACTIVE", listings: { some: { marketId: market.id, webPublicationStatus: "PUBLISHED" } } }, include: bundleInclude });
  return row ? publicBundle(row, market.id) : null;
}
