import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  getPublicBundleBySlug, getPublicCategories, getPublicProductBySlug,
  type PublicBundle, type PublicCategory, type PublicMoney, type PublicProductCard, type PublicProductDetail,
} from "./public-catalogue";

export const PUBLIC_SORTS = ["name_asc", "price_asc", "price_desc"] as const;
export type PublicSort = typeof PUBLIC_SORTS[number];
export type PublicSearchFilters = {
  category?: string;
  color?: string;
  size?: string;
  minPriceMinor?: number;
  maxPriceMinor?: number;
};
export type PublicSearchOptions = PublicSearchFilters & { market: "EGYPT" | "MOROCCO"; q: string; page: number; pageSize: number; sort: PublicSort };
export type PublicFacet = { value: string; count: number };
export type PublicSearchResult = {
  version: 1;
  market: "EGYPT" | "MOROCCO";
  q: string;
  page: number;
  pageSize: number;
  total: number;
  sort: PublicSort;
  supportedSorts: readonly PublicSort[];
  facets: {
    categories: (PublicCategory & { count: number })[];
    colors: PublicFacet[];
    sizes: PublicFacet[];
    price: { minAmountMinor: number; maxAmountMinor: number; currency: "EGP" | "MAD" } | null;
  };
  items: (PublicProductCard | PublicBundle)[];
};
function marketCurrency(market: string): "EGP" | "MAD" { return market === "EGYPT" ? "EGP" : "MAD"; }
function withinPrice(price: PublicMoney, options: PublicSearchFilters) {
  return (options.minPriceMinor === undefined || price.amountMinor >= options.minPriceMinor)
    && (options.maxPriceMinor === undefined || price.amountMinor <= options.maxPriceMinor);
}
function publicProductCard(detail: PublicProductDetail, options: PublicSearchFilters): PublicProductCard | null {
  const offers = detail.offers.filter(offer =>
    (!options.color || offer.attributes.color === options.color)
    && (!options.size || offer.attributes.size === options.size)
    && withinPrice(offer.price, options));
  if (!offers.length) return null;
  const priced = offers.some(offer => offer.purchasable) ? offers.filter(offer => offer.purchasable) : offers;
  const lowest = priced.reduce((best, offer) => offer.price.amountMinor < best.price.amountMinor ? offer : best, priced[0]);
  return {
    kind: "product", slug: detail.slug, nameAr: detail.nameAr, nameEn: detail.nameEn,
    ...(detail.category ? { category: detail.category } : {}),
    price: lowest.price, purchasable: offers.some(offer => offer.purchasable),
    ...(lowest.media[0] ? { cover: lowest.media[0] } : detail.cover ? { cover: detail.cover } : {}),
  };
}
function addCount(map: Map<string, number>, value: string) { map.set(value, (map.get(value) ?? 0) + 1); }
function facets(products: PublicProductDetail[], bundles: PublicBundle[], market: string) {
  const categoryCounts = new Map<string, { category: PublicCategory; count: number }>();
  const colors = new Map<string, number>(), sizes = new Map<string, number>();
  const prices: number[] = [];
  for (const product of products) {
    if (product.category) {
      const current = categoryCounts.get(product.category.key);
      categoryCounts.set(product.category.key, { category: product.category, count: (current?.count ?? 0) + 1 });
    }
    const productColors = new Set<string>(), productSizes = new Set<string>();
    for (const offer of product.offers) {
      prices.push(offer.price.amountMinor);
      if (offer.attributes.color) productColors.add(offer.attributes.color);
      if (offer.attributes.size) productSizes.add(offer.attributes.size);
    }
    for (const color of productColors) addCount(colors, color);
    for (const size of productSizes) addCount(sizes, size);
  }
  for (const bundle of bundles) prices.push(bundle.price.amountMinor);
  return {
    categories: [...categoryCounts.values()].map(({ category, count }) => ({ ...category, count })).sort((a, b) => a.name.localeCompare(b.name)),
    colors: [...colors].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value)),
    sizes: [...sizes].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value)),
    price: prices.length ? { minAmountMinor: prices.reduce((a, b) => Math.min(a, b)), maxAmountMinor: prices.reduce((a, b) => Math.max(a, b)), currency: marketCurrency(market) } : null,
  };
}
function displayName(item: PublicProductCard | PublicBundle) { return item.kind === "product" ? item.nameEn : item.name; }
function sortItems(items: (PublicProductCard | PublicBundle)[], sort: PublicSort) {
  items.sort((a, b) => {
    const byPrice = a.price.amountMinor - b.price.amountMinor;
    if (sort === "price_asc" && byPrice) return byPrice;
    if (sort === "price_desc" && byPrice) return -byPrice;
    return displayName(a).localeCompare(displayName(b)) || a.kind.localeCompare(b.kind) || a.slug.localeCompare(b.slug);
  });
}
export async function searchPublicCatalogue(options: PublicSearchOptions): Promise<PublicSearchResult | null> {
  const market = await prisma.market.findUnique({ where: { code: options.market } });
  if (!market || market.currency !== marketCurrency(options.market)) return null;
  const query = options.q.trim();
  const productWhere: Prisma.ProductWhereInput = {
    status: "ACTIVE", publicSlug: { not: null },
    listings: { some: { marketId: market.id, webPublicationStatus: "PUBLISHED" } },
    ...(query ? { OR: [
      { nameEn: { contains: query, mode: "insensitive" } },
      { nameAr: { contains: query, mode: "insensitive" } },
      { descriptionEn: { contains: query, mode: "insensitive" } },
      { descriptionAr: { contains: query, mode: "insensitive" } },
      { category: { archived: false, name: { contains: query, mode: "insensitive" } } },
    ] } : {}),
  };
  const bundleWhere: Prisma.BundleWhereInput = {
    status: "ACTIVE", publicSlug: { not: null },
    listings: { some: { marketId: market.id, webPublicationStatus: "PUBLISHED" } },
    ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
  };
  const [productRows, bundleRows] = await Promise.all([
    prisma.product.findMany({ where: productWhere, select: { publicSlug: true }, orderBy: { publicSlug: "asc" } }),
    prisma.bundle.findMany({ where: bundleWhere, select: { publicSlug: true }, orderBy: { publicSlug: "asc" } }),
  ]);
  const [products, bundleCandidates] = await Promise.all([
    Promise.all(productRows.map(row => getPublicProductBySlug(options.market, row.publicSlug!))),
    Promise.all(bundleRows.map(row => getPublicBundleBySlug(options.market, row.publicSlug!))),
  ]);
  const visibleProducts = products.filter((item): item is PublicProductDetail => !!item);
  const visibleBundles = bundleCandidates.filter((item): item is PublicBundle => !!item);
  const facetProducts: PublicProductDetail[] = [];
  const facetBundles: PublicBundle[] = [];
  const items: (PublicProductCard | PublicBundle)[] = [];
  for (const product of visibleProducts) {
    if (options.category && product.category?.key !== options.category) continue;
    const card = publicProductCard(product, options);
    if (card) {
      items.push(card);
      facetProducts.push({ ...product, offers: product.offers.filter(offer =>
        (!options.color || offer.attributes.color === options.color)
        && (!options.size || offer.attributes.size === options.size)
        && withinPrice(offer.price, options)) });
    }
  }
  if (!options.category && !options.color && !options.size) {
    for (const bundle of visibleBundles) if (withinPrice(bundle.price, options)) { items.push(bundle); facetBundles.push(bundle); }
  }
  const allFacets = facets(facetProducts, facetBundles, options.market);
  sortItems(items, options.sort);
  const start = (options.page - 1) * options.pageSize;
  return {
    version: 1, market: options.market, q: query, page: options.page, pageSize: options.pageSize,
    total: items.length, sort: options.sort, supportedSorts: PUBLIC_SORTS,
    facets: allFacets, items: items.slice(start, start + options.pageSize),
  };
}
export async function publicSuggestions(marketCode: string, q: string) {
  if (marketCode !== "EGYPT" && marketCode !== "MOROCCO") return null;
  const market = await prisma.market.findUnique({ where: { code: marketCode } });
  if (!market || market.currency !== marketCurrency(marketCode)) return null;
  const query = q.trim();
  if (!query) return { version: 1 as const, market: marketCode, products: [], categories: [] };
  const [productRows, categoryResponse] = await Promise.all([
    prisma.product.findMany({
      where: {
        status: "ACTIVE", publicSlug: { not: null },
        listings: { some: { marketId: market.id, webPublicationStatus: "PUBLISHED" } },
        OR: [{ nameEn: { contains: query, mode: "insensitive" } }, { nameAr: { contains: query, mode: "insensitive" } }],
      },
      select: { publicSlug: true, nameEn: true, nameAr: true },
      orderBy: [{ nameEn: "asc" }, { id: "asc" }], take: 5,
    }),
    getPublicCategories(marketCode),
  ]);
  return {
    version: 1 as const, market: marketCode,
    products: productRows.map(row => ({ kind: "product" as const, slug: row.publicSlug!, nameEn: row.nameEn, nameAr: row.nameAr })),
    categories: (categoryResponse?.items ?? []).filter(item => item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 5),
  };
}
