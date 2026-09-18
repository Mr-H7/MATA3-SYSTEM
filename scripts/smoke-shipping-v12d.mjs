import { spawn } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const url = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/mata3_shipping_v12d_test") throw Error("isolated local test DB required");
const system = process.cwd(), store = "E:\\MATA3 STORE";
const { PrismaClient } = require("@prisma/client"), db = new PrismaClient();
const processes = [];
function start(cwd, port, env) {
  const child = spawn(process.execPath, [path.join(cwd, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], {
    cwd, env: { ...process.env, ...env }, stdio: "ignore",
  });
  processes.push(child);
}
async function ready(target) {
  for (let i = 0; i < 80; i++) {
    try { const response = await fetch(target); if (response.status !== 502) return; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error("built app unavailable");
}
async function main() {
  const destination = await db.shippingDestination.findFirstOrThrow({ where: { market: { code: "EGYPT" }, kind: "CITY" } });
  const listing = await db.marketListing.findFirstOrThrow({ where: { market: { code: "EGYPT" }, product: { publicSlug: "shipping-test-product" } } });
  const secret = "isolated-test-confirmation-secret-123456789";
  const sessionSecret = "isolated-owner-session-secret-123456789";
  const owner = await db.user.upsert({ where: { email: "shipping-owner@example.test" }, create: { name: "Shipping Test Owner", email: "shipping-owner@example.test", passwordHash: "unused", role: "OWNER" }, update: {} });
  const seller = await db.user.upsert({ where: { email: "shipping-seller@example.test" }, create: { name: "Shipping Test Seller", email: "shipping-seller@example.test", passwordHash: "unused", role: "SELLER" }, update: {} });
  const cookie = user => "mata3_session=" + user.id + "." + createHmac("sha256", sessionSecret).update(user.id).digest("hex");
  start(system, 3211, { MATA3_CONFIRMATION_SECRET: secret, SESSION_SECRET: sessionSecret });
  await ready("http://localhost:3211/api/public/v1/checkout/config?market=EGYPT");
  start(store, 3212, { MATA3_PUBLIC_API_BASE_URL: "http://localhost:3211" });
  await ready("http://localhost:3212/api/checkout/config?market=eg");
  let response = await fetch("http://localhost:3211/api/shipping", { redirect: "manual" });
  assert.equal(response.status, 307);
  response = await fetch("http://localhost:3211/api/shipping", { headers: { Cookie: cookie(seller) } });
  assert.equal(response.status, 403);
  response = await fetch("http://localhost:3211/api/shipping", { headers: { Cookie: cookie(owner) } });
  assert.equal(response.status, 200);
  response = await fetch("http://localhost:3211/api/shipping", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie(seller) }, body: "{}" });
  assert.equal(response.status, 403);
  const region = await db.shippingDestination.findFirstOrThrow({ where: { marketId: destination.marketId, kind: "REGION" } });
  response = await fetch("http://localhost:3211/api/shipping", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie(owner) },
    body: JSON.stringify({ type: "destination", market: "EGYPT", kind: "CITY", name: "Smoke City", parentKey: region.publicKey }) });
  assert.equal(response.status, 201);
  let adminResponse = await fetch("http://localhost:3211/api/shipping", { headers: { Cookie: cookie(owner) } });
  let adminValue = await adminResponse.json();
  const smokeCity = adminValue.markets.find(row => row.market === "EGYPT").destinations.find(row => row.name === "Smoke City");
  assert(smokeCity && !smokeCity.active);
  response = await fetch("http://localhost:3211/api/shipping", { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie(owner) },
    body: JSON.stringify({ type: "destination", market: "EGYPT", id: smokeCity.id, active: true }) });
  assert.equal(response.status, 200);
  response = await fetch("http://localhost:3212/api/checkout/config?market=eg&destinationKey=" + smokeCity.publicKey);
  assert.equal((await response.json()).shippingStatus, "UNAVAILABLE");
  response = await fetch("http://localhost:3211/api/shipping", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie(owner) },
    body: JSON.stringify({ type: "tariff", market: "EGYPT", methodCode: "STANDARD", destinationKey: smokeCity.publicKey,
      amountMinor: 2200, effectiveFrom: new Date(Date.now() - 60000).toISOString() }) });
  assert.equal(response.status, 201);
  adminResponse = await fetch("http://localhost:3211/api/shipping", { headers: { Cookie: cookie(owner) } });
  adminValue = await adminResponse.json();
  const smokeTariff = adminValue.markets.find(row => row.market === "EGYPT").tariffs.find(row => row.destinationId === smokeCity.id);
  assert(smokeTariff && !smokeTariff.active);
  response = await fetch("http://localhost:3211/api/shipping", { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie(owner) },
    body: JSON.stringify({ type: "tariff", market: "EGYPT", id: smokeTariff.id, active: true }) });
  assert.equal(response.status, 200);
  response = await fetch("http://localhost:3212/api/checkout/config?market=eg&destinationKey=" + smokeCity.publicKey);
  assert.equal((await response.json()).deliveryMethods[0].amountMinor, 2200);
  response = await fetch("http://localhost:3212/api/checkout/config?market=eg&destinationKey=" + destination.publicKey);
  assert.equal(response.status, 200);
  let value = await response.json();
  assert.equal(value.version, 2);
  assert.equal(value.shippingStatus, "AVAILABLE");
  assert.equal(value.deliveryMethods[0].amountMinor, 7000);
  assert(!JSON.stringify(value).includes("providerCityId"));
  assert(!JSON.stringify(value).includes("shippingTariffId"));
  response = await fetch("http://localhost:3212/api/checkout/quote", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ market: "eg", destinationKey: destination.publicKey, deliveryCode: "STANDARD",
      lines: [{ key: listing.publicOfferId, quantity: 1 }], shippingAmountMinor: 1 }) });
  assert.equal(response.status, 200);
  value = await response.json();
  assert.equal(value.delivery.amount.amountMinor, 7000);
  assert.equal(value.itemsSubtotal.amountMinor, 10000);
  assert.equal(value.grandTotal.amountMinor, 17000);
  assert.equal(value.canProceed, true);
  response = await fetch("http://localhost:3212/api/checkout/quote", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ market: "eg", destinationKey: "00000000-0000-4000-8000-000000000000", deliveryCode: "STANDARD",
      lines: [{ key: listing.publicOfferId, quantity: 1 }] }) });
  assert.equal(response.status, 409);
  value = await response.json(); assert.equal(value.code, "DESTINATION_UNAVAILABLE");
  const order = await db.storefrontOrder.findFirstOrThrow({ where: { marketCode: "EGYPT", fulfillmentStatus: "READY_FOR_FULFILLMENT" } });
  response = await fetch("http://localhost:3211/api/storefront-orders/" + order.reference + "/fulfillment", {
    method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie(seller) }, body: JSON.stringify({ status: "MANUAL_FULFILLMENT" }) });
  assert.equal(response.status, 403);
  response = await fetch("http://localhost:3211/api/storefront-orders/" + order.reference + "/fulfillment", {
    method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie(owner) }, body: JSON.stringify({ status: "MANUAL_FULFILLMENT" }) });
  assert.equal(response.status, 200);
  const afterFulfillment = await db.storefrontOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(afterFulfillment.fulfillmentStatus, "MANUAL_FULFILLMENT");
  assert.equal(afterFulfillment.status, order.status);
  assert.equal(afterFulfillment.paymentStatus, order.paymentStatus);
  start(store, 3213, { MATA3_PUBLIC_API_BASE_URL: "http://127.0.0.1:1" });
  await ready("http://localhost:3213/api/checkout/config?market=eg");
  response = await fetch("http://localhost:3213/api/checkout/config?market=eg");
  assert.equal(response.status, 503);
  value = await response.json(); assert.equal(value.code, "CHECKOUT_CONFIG_ERROR");
  console.log("shipping v1.2D built-app HTTP smoke passed");
}
main().finally(async () => { for (const child of processes) child.kill(); await db.$disconnect(); });
