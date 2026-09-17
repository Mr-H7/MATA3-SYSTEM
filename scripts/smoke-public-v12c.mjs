import { spawn } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const system = process.cwd(), store = "E:\\MATA3 STORE";
const url = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/mata3_catalogue_v12b_test") throw Error("Isolated local test DB required");
const delivery = JSON.stringify([{ market: "EGYPT", code: "TEST_DELIVERY_EG", label: "Configured Egypt delivery", amountMinor: 5000, enabled: true }, { market: "MOROCCO", code: "TEST_DELIVERY_MA", label: "Configured Morocco delivery", amountMinor: 1500, enabled: true }]);
const processes = [];
function start(cwd, port, env) {
  const child = spawn(process.execPath, [path.join(cwd, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], { cwd, env: { ...process.env, ...env }, stdio: "ignore" });
  processes.push(child);
}
async function ready(target) {
  for (let i = 0; i < 80; i++) { try { const response = await fetch(target); if (response.status !== 502) return; } catch { /* starting */ } await new Promise(resolve => setTimeout(resolve, 500)); }
  throw Error("Built app unavailable");
}
async function main() {
  start(system, 3201, { SESSION_SECRET: "isolated-test-staff-session-secret-123456", MATA3_CONFIRMATION_SECRET: "isolated-test-confirmation-secret-123456789", MATA3_DELIVERY_CONFIG_JSON: delivery });
  await ready("http://localhost:3201/api/public/v1/checkout/config?market=MOROCCO");
  start(store, 3202, { MATA3_PUBLIC_API_BASE_URL: "http://localhost:3201" });
  await ready("http://localhost:3202/ma/en/checkout");
  let response = await fetch("http://localhost:3202/api/checkout/config?market=ma");
  assert.equal(response.status, 200);
  let value = await response.json();
  assert.equal(value.checkoutAvailable, true);
  assert.equal(value.deliveryMethods[0].amountMinor, 1500);
  const { PrismaClient } = require("@prisma/client"), db = new PrismaClient();
  const listing = await db.marketListing.findFirst({ where: { market: { code: "MOROCCO" }, product: { publicSlug: "controller" }, variant: { color: "Black" } } });
  assert(listing);
  response = await fetch("http://localhost:3202/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    market: "ma", idempotencyKey: randomUUID(), lines: [{ key: listing.publicOfferId, quantity: 1 }],
    customer: { fullName: "Smoke Guest", phone: "0612345678", region: "Test Region", city: "Test City", address: "12 Test Street" },
    deliveryCode: "TEST_DELIVERY_MA", paymentCode: "BANK_TRANSFER",
  }) });
  assert.equal(response.status, 201);
  value = await response.json();
  assert.equal(value.order.status, "RECEIVED");
  assert.equal(value.order.paymentStatus, "PENDING");
  assert.equal(value.order.grandTotal.amountMinor, 81400);
  const reference = value.order.reference, token = value.confirmationToken;
  response = await fetch("http://localhost:3202/api/orders/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference, token: "" }) });
  assert.equal(response.status, 404);
  response = await fetch("http://localhost:3202/api/orders/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference, token }) });
  assert.equal(response.status, 200);
  response = await fetch("http://localhost:3202/api/orders/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference, phone: "0612345678" }) });
  assert.equal(response.status, 200);
  value = await response.json();
  assert.equal(value.reference, reference);
  assert.equal(value.address.detailedAddress, undefined);
  response = await fetch("http://localhost:3202/api/orders/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference, phone: "0612345679" }) });
  assert.equal(response.status, 404);
  response = await fetch("http://localhost:3201/api/storefront-orders/" + reference + "/status", { method: "PATCH", redirect: "manual", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "PROCESSING" }) });
  assert.ok(response.status === 307 || response.status === 403);
  const owner = await db.user.create({ data: { name: "Test Owner", email: "smoke-owner@example.test", passwordHash: "TEST-NOT-A-LOGIN", role: "OWNER" } });
  const signature = createHmac("sha256", "isolated-test-staff-session-secret-123456").update(owner.id).digest("hex");
  const cookie = "mata3_session=" + owner.id + "." + signature;
  response = await fetch("http://localhost:3201/api/storefront-orders/" + reference, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const beforeCancel = await db.inventory.findUniqueOrThrow({ where: { listingId: listing.id } });
  response = await fetch("http://localhost:3201/api/storefront-orders/" + reference + "/status", { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ status: "CANCELLED" }) });
  assert.equal(response.status, 200);
  const afterCancel = await db.inventory.findUniqueOrThrow({ where: { listingId: listing.id } });
  assert.equal(afterCancel.currentStock, beforeCancel.currentStock + 1);
  response = await fetch("http://localhost:3201/api/storefront-orders/" + reference + "/status", { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ status: "CANCELLED" }) });
  assert.equal(response.status, 409);
  const afterRepeat = await db.inventory.findUniqueOrThrow({ where: { listingId: listing.id } });
  assert.equal(afterRepeat.currentStock, afterCancel.currentStock);
  response = await fetch("http://localhost:3202/api/orders/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference, phone: "0612345678" }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "CANCELLED");
  response = await fetch("http://localhost:3202/ma/en/checkout");
  assert.equal(response.status, 200);
  await db.$disconnect();
  console.log("Built System/Store v1.2C HTTP smoke passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { for (const child of processes) child.kill(); });
