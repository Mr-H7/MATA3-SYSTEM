import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { checkoutConfiguration } from "../lib/checkout-config";
import { createGuestOrder, GuestOrderError } from "../lib/guest-order";
import { resolveShipping, ShippingUnavailable } from "../lib/shipping";
import { prisma } from "../lib/prisma";
const url = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/mata3_shipping_v12d_test") throw Error("isolated local test DB required");
process.env.MATA3_CONFIRMATION_SECRET = "isolated-test-confirmation-secret-123456789";
const db = new PrismaClient();
async function main() {
  const eg = await db.market.create({ data: { code: "EGYPT", name: "Egypt", currency: "EGP" } });
  const ma = await db.market.create({ data: { code: "MOROCCO", name: "Morocco", currency: "MAD" } });
  const egRegion = await db.shippingDestination.create({ data: { marketId: eg.id, kind: "REGION", name: "Test EG Region", active: true } });
  const egCity = await db.shippingDestination.create({ data: { marketId: eg.id, kind: "CITY", name: "Test EG City", parentId: egRegion.id, active: true } });
  const maRegion = await db.shippingDestination.create({ data: { marketId: ma.id, kind: "REGION", name: "Test MA Region", active: true } });
  const maCity = await db.shippingDestination.create({ data: { marketId: ma.id, kind: "CITY", name: "Test MA City", parentId: maRegion.id, active: true } });
  const egMethod = await db.shippingMethod.create({ data: { marketId: eg.id, provider: "BOSTA", code: "STANDARD", label: "Approved Egypt delivery", active: true } });
  const maMethod = await db.shippingMethod.create({ data: { marketId: ma.id, provider: "OZONEXPRESS", code: "STANDARD", label: "Approved Morocco delivery", active: true } });
  await db.shippingMarketConfiguration.createMany({ data: [{ marketId: eg.id, enabled: true }, { marketId: ma.id, enabled: true }] });
  const from = new Date(Date.now() - 60000);
  const egRate = await db.shippingTariff.create({ data: { marketId: eg.id, methodId: egMethod.id, destinationId: egCity.id, amountMinor: 5000,
    currency: "EGP", active: true, effectiveFrom: from } });
  const maRate = await db.shippingTariff.create({ data: { marketId: ma.id, methodId: maMethod.id, destinationId: maCity.id, amountMinor: 1500,
    currency: "MAD", active: true, effectiveFrom: from } });
  let egConfig = await checkoutConfiguration("EGYPT", egCity.publicKey), maConfig = await checkoutConfiguration("MOROCCO", maCity.publicKey);
  assert.equal(egConfig.deliveryMethods[0].amountMinor, 5000);
  assert.equal(egConfig.deliveryMethods[0].currency, "EGP");
  assert.equal(maConfig.deliveryMethods[0].amountMinor, 1500);
  assert.equal(maConfig.deliveryMethods[0].currency, "MAD");
  assert.equal(egConfig.deliveryMethods[0].pricingProvenance, "APPROVED_TARIFF");
  assert(!JSON.stringify(egConfig).includes("providerCityId"));
  assert(!JSON.stringify(egConfig).includes(egRate.id));
  await db.shippingDestination.update({ where: { id: egRegion.id }, data: { active: false } });
  const disabledParent = await checkoutConfiguration("EGYPT", egCity.publicKey);
  assert(!disabledParent.destinations.some(destination => destination.key === egCity.publicKey));
  assert.equal(disabledParent.deliveryMethods.length, 0);
  await db.shippingDestination.update({ where: { id: egRegion.id }, data: { active: true } });
  await assert.rejects(() => resolveShipping(prisma, "EGYPT", maCity.publicKey, "STANDARD"), e => e instanceof ShippingUnavailable && e.code === "DESTINATION_UNAVAILABLE");
  await assert.rejects(() => resolveShipping(prisma, "EGYPT", randomUUID(), "STANDARD"), e => e instanceof ShippingUnavailable && e.code === "DESTINATION_UNAVAILABLE");
  await db.shippingTariff.update({ where: { id: egRate.id }, data: { active: false } });
  egConfig = await checkoutConfiguration("EGYPT", egCity.publicKey);
  assert.equal(egConfig.shippingStatus, "UNAVAILABLE");
  await db.shippingTariff.update({ where: { id: egRate.id }, data: { active: true, effectiveFrom: new Date(Date.now() + 60000) } });
  assert.equal((await checkoutConfiguration("EGYPT", egCity.publicKey)).deliveryMethods.length, 0);
  await db.shippingTariff.update({ where: { id: egRate.id }, data: { effectiveFrom: new Date(Date.now() - 120000), effectiveTo: new Date(Date.now() - 60000) } });
  assert.equal((await checkoutConfiguration("EGYPT", egCity.publicKey)).deliveryMethods.length, 0);
  await db.shippingTariff.update({ where: { id: egRate.id }, data: { effectiveFrom: from, effectiveTo: null } });
  await db.shippingMethod.update({ where: { id: egMethod.id }, data: { active: false } });
  assert.equal((await checkoutConfiguration("EGYPT", egCity.publicKey)).deliveryMethods.length, 0);
  await db.shippingMethod.update({ where: { id: egMethod.id }, data: { active: true } });
  await db.shippingMarketConfiguration.update({ where: { marketId: eg.id }, data: { enabled: false } });
  assert.equal((await checkoutConfiguration("EGYPT", egCity.publicKey)).shippingStatus, "NOT_CONFIGURED");
  await db.shippingMarketConfiguration.update({ where: { marketId: eg.id }, data: { enabled: true } });
  const product = await db.product.create({ data: { sku: "SHIPPING-TEST-EG", nameAr: "منتج تجريبي", nameEn: "Shipping Test Product",
    status: "ACTIVE", publicSlug: "shipping-test-product" } });
  const listing = await db.marketListing.create({ data: { marketId: eg.id, productId: product.id, price: 100, cost: 50, webPublicationStatus: "PUBLISHED" } });
  await db.inventory.create({ data: { marketId: eg.id, listingId: listing.id, currentStock: 3 } });
  const input = { market: "EGYPT" as const, lines: [{ key: listing.publicOfferId, quantity: 1 }], idempotencyKey: randomUUID(),
    destinationKey: egCity.publicKey, deliveryCode: "STANDARD", paymentCode: "BANK_TRANSFER",
    customer: { fullName: "Test Guest", phone: "01012345678", region: "Tampered Region", city: "Tampered City", address: "12 Test Street" } };
  const beforeStock = await db.inventory.findUniqueOrThrow({ where: { listingId: listing.id } });
  await assert.rejects(() => createGuestOrder({ ...input, destinationKey: maCity.publicKey, idempotencyKey: randomUUID() }),
    e => e instanceof GuestOrderError && e.code === "CHECKOUT_UNAVAILABLE");
  const created = await createGuestOrder(input);
  assert.equal(created.order.delivery.amount.amountMinor, 5000);
  assert.equal(created.order.grandTotal.amountMinor, 15000);
  assert.equal(created.order.address.region, "Test EG Region");
  assert.equal(created.order.address.city, "Test EG City");
  assert.equal(created.order.paymentStatus, "PENDING");
  const frozen = await db.storefrontOrder.findUniqueOrThrow({ where: { reference: created.order.reference } });
  assert.equal(frozen.shippingProvider, "BOSTA");
  assert.equal(frozen.shippingPricingProvenance, "APPROVED_TARIFF");
  assert.equal(frozen.shippingTariffId, egRate.id);
  assert.equal(frozen.fulfillmentStatus, "READY_FOR_FULFILLMENT");
  assert.equal((await db.inventory.findUniqueOrThrow({ where: { listingId: listing.id } })).currentStock, beforeStock.currentStock - 1);
  await db.shippingTariff.update({ where: { id: egRate.id }, data: { active: false } });
  const later = await db.shippingTariff.create({ data: { marketId: eg.id, methodId: egMethod.id, destinationId: egCity.id, amountMinor: 7000,
    currency: "EGP", active: true, effectiveFrom: from } });
  const tampered = { ...input, idempotencyKey: randomUUID(), shippingAmountMinor: 1 };
  const current = await createGuestOrder(tampered);
  assert.equal(current.order.delivery.amount.amountMinor, 7000);
  const changedClientAmount = { ...tampered, shippingAmountMinor: 999 };
  const tamperedReplay = await createGuestOrder(changedClientAmount);
  assert.equal(tamperedReplay.replayed, true);
  assert.equal(tamperedReplay.order.reference, current.order.reference);
  const replay = await createGuestOrder(input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.order.delivery.amount.amountMinor, 5000);
  assert.equal((await db.storefrontOrder.findUniqueOrThrow({ where: { reference: created.order.reference } })).deliveryAmount.toString(), "50");
  assert.equal((await checkoutConfiguration("EGYPT", egCity.publicKey)).deliveryMethods[0].amountMinor, 7000);
  assert.equal(later.provenance, "APPROVED_TARIFF");
  await db.shippingTariff.update({ where: { id: maRate.id }, data: { active: false } });
  assert.equal((await checkoutConfiguration("MOROCCO", maCity.publicKey)).checkoutAvailable, false);
  console.log("shipping v1.2D isolated integration checks passed");
}
main().finally(async () => { await db.$disconnect(); await prisma.$disconnect(); });
