import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { importApprovedMedia } from "../lib/approved-media-import";
import { createGuestOrder, GuestOrderError } from "../lib/guest-order";
import { quotePublicCart } from "../lib/public-cart-quote";

const database = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.pathname !== "/mata3_ondemand_test") {
  throw new Error("isolated local test DB required");
}
process.env.MATA3_CONFIRMATION_SECRET = "isolated-on-demand-confirmation-secret-123456";
const db = new PrismaClient();
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

async function orderInput(market: "EGYPT" | "MOROCCO", key: string, destinationKey: string, quantity = 1, idempotencyKey = randomUUID()) {
  return {
    market, lines: [{ key, quantity }], idempotencyKey, destinationKey, deliveryCode: "STANDARD", paymentCode: "BANK_TRANSFER",
    customer: {
      fullName: "Test Guest", phone: market === "EGYPT" ? "01012345678" : "0612345678",
      region: "Region", city: "City", address: "12 Test Street",
    },
  };
}

async function main() {
  const eg = await db.market.create({ data: { code: "EGYPT", name: "Egypt", currency: "EGP" } });
  const ma = await db.market.create({ data: { code: "MOROCCO", name: "Morocco", currency: "MAD" } });
  const supplier = await db.supplier.create({ data: { name: "Test Supplier", marketId: ma.id } });
  const from = new Date(Date.now() - 60_000);
  const egRegion = await db.shippingDestination.create({ data: { marketId: eg.id, kind: "REGION", name: "EG Region", active: true } });
  const egCity = await db.shippingDestination.create({ data: { marketId: eg.id, kind: "CITY", name: "EG City", parentId: egRegion.id, active: true } });
  const maRegion = await db.shippingDestination.create({ data: { marketId: ma.id, kind: "REGION", name: "MA Region", active: true } });
  const maCity = await db.shippingDestination.create({ data: { marketId: ma.id, kind: "CITY", name: "MA City", parentId: maRegion.id, active: true } });
  const egMethod = await db.shippingMethod.create({ data: { marketId: eg.id, provider: "BOSTA", code: "STANDARD", label: "Egypt delivery", active: true } });
  const maMethod = await db.shippingMethod.create({ data: { marketId: ma.id, provider: "OZONEXPRESS", code: "STANDARD", label: "Morocco delivery", active: true } });
  await db.shippingMarketConfiguration.createMany({ data: [{ marketId: eg.id, enabled: true }, { marketId: ma.id, enabled: false }] });
  await db.shippingTariff.create({ data: { marketId: eg.id, methodId: egMethod.id, destinationId: egCity.id, amountMinor: 5000, currency: "EGP", active: true, effectiveFrom: from } });
  await db.shippingTariff.create({ data: { marketId: ma.id, methodId: maMethod.id, destinationId: maCity.id, amountMinor: 1500, currency: "MAD", active: true, effectiveFrom: from } });

  const owned = await db.product.create({ data: { sku: "OWNED-1", nameAr: "مخزون", nameEn: "Owned stock", status: "ACTIVE", publicSlug: "owned-stock" } });
  const ownedListing = await db.marketListing.create({ data: { marketId: eg.id, productId: owned.id, price: 100, cost: 40, webPublicationStatus: "PUBLISHED" } });
  await db.inventory.create({ data: { marketId: eg.id, listingId: ownedListing.id, currentStock: 4 } });

  const demandProduct = await db.product.create({ data: { sku: "SMSM-MODEL-1", nameAr: "حذاء", nameEn: "SMSM model", status: "ACTIVE", publicSlug: "smsm-model" } });
  const variant = await db.productVariant.create({ data: { productId: demandProduct.id, sku: "SMSM-MODEL-1-BLACK", color: "Black" } });
  const demand = await db.marketListing.create({ data: {
    marketId: ma.id, productId: demandProduct.id, variantId: variant.id, supplierId: supplier.id, price: 250, cost: 90,
    inventoryType: "ON_DEMAND", webPublicationStatus: "PUBLISHED",
  } });
  await db.inventory.create({ data: { marketId: ma.id, listingId: demand.id, currentStock: 7 } });
  const hidden = await db.marketListing.create({ data: {
    marketId: ma.id, productId: demandProduct.id, price: 10, cost: 1, inventoryType: "ON_DEMAND", webPublicationStatus: "HIDDEN",
    variantId: (await db.productVariant.create({ data: { productId: demandProduct.id, sku: "SMSM-MODEL-1-HIDDEN", color: "Hidden" } })).id,
  } });

  const ownedOrder = await createGuestOrder(await orderInput("EGYPT", ownedListing.publicOfferId, egCity.publicKey));
  assert.equal(ownedOrder.order.lines[0].fulfillment, "OWNED_STOCK");
  assert.equal((await db.inventory.findUniqueOrThrow({ where: { listingId: ownedListing.id } })).currentStock, 3);

  await db.shippingMarketConfiguration.update({ where: { marketId: ma.id }, data: { enabled: true } });
  const unapprovedQuote = await quotePublicCart("MOROCCO", [{ key: demand.publicOfferId, quantity: 1 }]);
  assert.equal(unapprovedQuote?.lines[0].codes.includes("UNAVAILABLE"), true);
  await assert.rejects(async () => createGuestOrder(await orderInput("MOROCCO", demand.publicOfferId, maCity.publicKey)), error => error instanceof GuestOrderError && error.code === "CART_CHANGED");

  await db.marketListing.update({ where: { id: demand.id }, data: { onDemandApproval: "APPROVED", onDemandBasis: "CONFIRMED_AVAILABILITY", onDemandMaxPerOrder: 2 } });
  const approvedQuote = await quotePublicCart("MOROCCO", [{ key: demand.publicOfferId, quantity: 2 }]);
  assert.equal(approvedQuote?.canProceed, true);
  const idempotencyKey = randomUUID();
  const supplierOrder = await createGuestOrder(await orderInput("MOROCCO", demand.publicOfferId, maCity.publicKey, 2, idempotencyKey));
  assert.equal(supplierOrder.order.lines[0].fulfillment, "SUPPLIER_ON_DEMAND");
  assert.equal(supplierOrder.replayed, false);
  assert.equal(JSON.stringify(supplierOrder.order).includes(supplier.id), false);
  assert.equal(JSON.stringify(supplierOrder.order).includes("90"), false);
  const stored = await db.storefrontOrder.findUniqueOrThrow({ where: { reference: supplierOrder.order.reference }, include: { lines: { include: { allocations: true } } } });
  assert.equal(stored.lines[0].fulfillmentSource, "SUPPLIER_ON_DEMAND");
  assert.equal(stored.lines[0].supplierId, supplier.id);
  assert.equal(stored.lines[0].allocations.length, 0);
  assert.equal(stored.fulfillmentStatus, "MANUAL_FULFILLMENT");
  assert.equal((await db.inventory.findUniqueOrThrow({ where: { listingId: demand.id } })).currentStock, 7);
  const replay = await createGuestOrder(await orderInput("MOROCCO", demand.publicOfferId, maCity.publicKey, 2, idempotencyKey));
  assert.equal(replay.replayed, true);
  assert.equal(replay.order.reference, supplierOrder.order.reference);
  assert.equal((await db.inventory.findUniqueOrThrow({ where: { listingId: demand.id } })).currentStock, 7);
  const duplicate = await orderInput("MOROCCO", demand.publicOfferId, maCity.publicKey, 2, idempotencyKey);
  const parallel = await Promise.all([createGuestOrder(duplicate), createGuestOrder(duplicate)]);
  assert.equal(parallel.every(result => result.order.reference === supplierOrder.order.reference), true);
  const freshKey = randomUUID();
  const fresh = await orderInput("MOROCCO", demand.publicOfferId, maCity.publicKey, 1, freshKey);
  const raced = await Promise.all([createGuestOrder(fresh), createGuestOrder(fresh)]);
  assert.equal(raced[0].order.reference, raced[1].order.reference);
  assert.equal((await db.inventory.findUniqueOrThrow({ where: { listingId: demand.id } })).currentStock, 7);

  const hiddenQuote = await quotePublicCart("MOROCCO", [{ key: hidden.publicOfferId, quantity: 1 }]);
  assert.equal(hiddenQuote?.lines[0].codes.includes("NOT_PUBLIC"), true);
  const wrongMarket = await quotePublicCart("EGYPT", [{ key: demand.publicOfferId, quantity: 1 }]);
  assert.equal(wrongMarket?.lines[0].codes.includes("WRONG_MARKET"), true);
  const invalidVariant = await quotePublicCart("MOROCCO", [{ key: randomUUID(), quantity: 1 }]);
  assert.equal(invalidVariant?.lines[0].codes.includes("INVALID_KEY"), true);
  const overLimit = await quotePublicCart("MOROCCO", [{ key: demand.publicOfferId, quantity: 3 }]);
  assert.equal(overLimit?.canProceed, false);
  assert.equal(overLimit?.lines[0].codes.includes("INVALID_QUANTITY"), true);
  await db.shippingMarketConfiguration.update({ where: { marketId: ma.id }, data: { enabled: false } });
  await assert.rejects(async () => createGuestOrder(await orderInput("MOROCCO", demand.publicOfferId, maCity.publicKey)), error => error instanceof GuestOrderError && error.code === "CHECKOUT_UNAVAILABLE");
  await db.shippingMarketConfiguration.update({ where: { marketId: ma.id }, data: { enabled: true } });

  const root = await mkdtemp(path.join(tmpdir(), "mata3-media-"));
  await mkdir(path.join(root, "black"), { recursive: true });
  await writeFile(path.join(root, "black", "01.jpg"), jpeg);
  await writeFile(path.join(root, "black", "02.jpg"), jpeg);
  await writeFile(path.join(root, "black", "03.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0x00]));
  const manifest = { version: 1 as const, market: "MOROCCO" as const, items: [{ sku: "SMSM-MODEL-1", color: "Black", images: [
    { file: "black/01.jpg", position: 1 as const, cover: true, alt: "Front" },
    { file: "black/02.jpg", position: 2 as const, cover: false, alt: "Side" },
    { file: "black/03.jpg", position: 3 as const, cover: false, alt: "Back" },
  ] }] };
  const dry = await importApprovedMedia(db, root, manifest, true);
  assert.equal(dry.accepted.length, 3);
  assert.equal(await db.webProductMedia.count({ where: { variantId: variant.id } }), 0);
  const applied = await importApprovedMedia(db, root, manifest, false);
  assert.equal(applied.accepted.every(row => row.action === "create"), true);
  assert.equal(await db.webProductMedia.count({ where: { variantId: variant.id, publicationStatus: "DRAFT" } }), 3);
  assert.equal(await db.webProductMedia.count({ where: { variantId: variant.id, isCover: true } }), 1);
  const again = await importApprovedMedia(db, root, manifest, false);
  assert.equal(again.accepted.every(row => row.action === "skip"), true);
  assert.equal(await db.webProductMedia.count({ where: { variantId: variant.id } }), 3);
  await writeFile(path.join(root, "black", "01.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0x01]));
  const conflict = await importApprovedMedia(db, root, manifest, false);
  assert.equal(conflict.rejected.some(row => row.position === 1), true);
  assert.equal(await db.webProductMedia.count({ where: { variantId: variant.id } }), 3);
  const unmatched = await importApprovedMedia(db, root, { ...manifest, items: [{ ...manifest.items[0], sku: "MISSING-SKU" }] }, true);
  assert.equal(unmatched.unmatched.length, 1);
  const wrongFile = await importApprovedMedia(db, root, { ...manifest, items: [{ ...manifest.items[0], images: manifest.items[0].images.map((image, index) => index === 2 ? { ...image, file: "black/missing.jpg" } : image) }] }, true);
  assert.equal(wrongFile.rejected.some(row => row.reason.includes("not found")), true);
  const escape = await importApprovedMedia(db, root, { ...manifest, items: [{ ...manifest.items[0], images: manifest.items[0].images.map((image, index) => index === 0 ? { ...image, file: "../secret.jpg" } : image) }] }, true);
  assert.equal(escape.rejected.some(row => row.reason.includes("outside")), true);
  const excludedProduct = await db.product.create({ data: { sku: "NB-574-CHAMOIS", nameAr: "مستبعد", nameEn: "NB 574 Chamois", status: "ACTIVE", publicSlug: "nb-574-chamois" } });
  const excludedVariant = await db.productVariant.create({ data: { productId: excludedProduct.id, sku: "NB-574-CHAMOIS-SAND", color: "Sand" } });
  await db.marketListing.create({ data: { marketId: ma.id, productId: excludedProduct.id, variantId: excludedVariant.id, price: 1, cost: 1, inventoryType: "ON_DEMAND" } });
  const excluded = await importApprovedMedia(db, root, { ...manifest, items: [{ sku: "NB-574-CHAMOIS", color: "Sand", images: manifest.items[0].images }] }, true);
  assert.equal(excluded.rejected.some(row => row.reason.includes("Excluded")), true);
  console.log("on-demand commerce checks passed");
}

main().catch(async error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await db.$disconnect();
});
