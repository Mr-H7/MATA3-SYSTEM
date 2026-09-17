import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { checkoutConfiguration } from "../lib/checkout-config";
import { confirmGuestOrder, createGuestOrder, GuestOrderError, trackGuestOrder, type GuestOrderInput } from "../lib/guest-order";
const db = new PrismaClient();
async function main() {
  if (!process.env.DATABASE_URL?.includes("/mata3_catalogue_v12b_test")) throw Error("Isolated test database required");
  process.env.MATA3_CONFIRMATION_SECRET = "isolated-test-confirmation-secret-123456789";
  process.env.MATA3_DELIVERY_CONFIG_JSON = JSON.stringify([
    { market: "EGYPT", code: "TEST_DELIVERY_EG", label: "Configured Egypt delivery", amountMinor: 5000, enabled: true },
    { market: "MOROCCO", code: "TEST_DELIVERY_MA", label: "Configured Morocco delivery", amountMinor: 1500, enabled: true },
  ]);
  const eg = await db.market.findUniqueOrThrow({ where: { code: "EGYPT" } }), ma = await db.market.findUniqueOrThrow({ where: { code: "MOROCCO" } });
  const blackEg = await db.marketListing.findFirstOrThrow({ where: { marketId: eg.id, product: { publicSlug: "controller" }, variant: { color: "Black" } } });
  const blackMa = await db.marketListing.findFirstOrThrow({ where: { marketId: ma.id, product: { publicSlug: "controller" }, variant: { color: "Black" } } });
  const bundle = await db.bundleMarketListing.findFirstOrThrow({ where: { marketId: eg.id, bundle: { publicSlug: "controller-bundle" } } });
  const draft = await db.marketListing.findFirstOrThrow({ where: { product: { publicSlug: "controller-draft" } } }).catch(async () => db.marketListing.findFirstOrThrow({ where: { webPublicationStatus: "DRAFT" } }));
  const hidden = await db.marketListing.findFirstOrThrow({ where: { webPublicationStatus: "HIDDEN" } });
  const inactive = await db.marketListing.findFirstOrThrow({ where: { product: { publicSlug: "controller-inactive" } } });
  const input = (key: string, market: "EGYPT" | "MOROCCO" = "EGYPT", quantity = 1): GuestOrderInput => ({
    market, idempotencyKey: randomUUID(), lines: [{ key, quantity }],
    customer: { fullName: "Guest Customer", phone: market === "EGYPT" ? "01012345678" : "0612345678", region: "Test Region", city: "Test City", address: "12 Test Street" },
    deliveryCode: market === "EGYPT" ? "TEST_DELIVERY_EG" : "TEST_DELIVERY_MA", paymentCode: "BANK_TRANSFER",
  });
  const fail = async (value: GuestOrderInput, code: string) => assert.rejects(() => createGuestOrder(value), error => error instanceof GuestOrderError && error.code === code);
  const priorConfig = process.env.MATA3_DELIVERY_CONFIG_JSON; delete process.env.MATA3_DELIVERY_CONFIG_JSON;
  assert.equal(checkoutConfiguration("EGYPT").checkoutAvailable, false);
  await fail(input(blackEg.publicOfferId), "CHECKOUT_UNAVAILABLE");
  process.env.MATA3_DELIVERY_CONFIG_JSON = priorConfig;
  await fail(input(blackEg.publicOfferId, "MOROCCO"), "CART_CHANGED");
  await fail(input(draft.publicOfferId), "CART_CHANGED");
  await fail(input(hidden.publicOfferId), "CART_CHANGED");
  await fail(input(inactive.publicOfferId), "CART_CHANGED");
  await fail({ ...input(blackEg.publicOfferId), lines: [{ key: blackEg.publicOfferId, quantity: 1, observedUnitAmountMinor: 64900 }] }, "CART_CHANGED");
  await fail(input(bundle.publicOfferId, "EGYPT", 3), "CART_CHANGED");
  await fail({ ...input(bundle.publicOfferId), lines: [{ key: bundle.publicOfferId, quantity: 1 }, { key: blackEg.publicOfferId, quantity: 3 }] }, "CART_CHANGED");
  const beforeRollback = { inventory: await db.inventory.findMany({ select: { id: true, currentStock: true } }), movements: await db.inventoryMovement.count(), orders: await db.storefrontOrder.count() };
  await db.$executeRawUnsafe("CREATE FUNCTION test_guest_rollback() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END; $$ LANGUAGE plpgsql");
  await db.$executeRawUnsafe('CREATE TRIGGER test_guest_rollback_trigger BEFORE INSERT ON "StorefrontOrder" FOR EACH ROW EXECUTE FUNCTION test_guest_rollback()');
  try { await assert.rejects(() => createGuestOrder(input(blackEg.publicOfferId))); }
  finally {
    await db.$executeRawUnsafe('DROP TRIGGER test_guest_rollback_trigger ON "StorefrontOrder"');
    await db.$executeRawUnsafe("DROP FUNCTION test_guest_rollback()");
  }
  assert.deepEqual({ inventory: await db.inventory.findMany({ select: { id: true, currentStock: true } }), movements: await db.inventoryMovement.count(), orders: await db.storefrontOrder.count() }, beforeRollback);
  const bundleInput = input(bundle.publicOfferId);
  const beforeBundle = await db.inventory.findMany({ select: { id: true, currentStock: true } });
  const createdBundle = await createGuestOrder(bundleInput);
  assert.equal(createdBundle.order.status, "RECEIVED");
  assert.equal(createdBundle.order.paymentStatus, "PENDING");
  assert.equal(createdBundle.order.itemsSubtotal.amountMinor, 94900);
  assert.equal(createdBundle.order.grandTotal.amountMinor, 99900);
  assert.equal(createdBundle.order.currency, "EGP");
  assert.match(createdBundle.order.reference, /^MTA-EG-[A-Z2-9]{12}$/);
  assert.equal(createdBundle.order.lines[0].kind, "bundle");
  assert.equal((await db.storefrontOrderLine.findFirstOrThrow({ where: { order: { reference: createdBundle.order.reference } }, include: { allocations: true } })).allocations.reduce((sum, a) => sum + a.quantityPerOrderUnit, 0), 3);
  assert.notDeepEqual(await db.inventory.findMany({ select: { id: true, currentStock: true } }), beforeBundle);
  const movementsAfterBundle = await db.inventoryMovement.count();
  const replay = await createGuestOrder(bundleInput);
  assert.equal(replay.replayed, true);
  assert.equal(replay.order.reference, createdBundle.order.reference);
  assert.equal(replay.confirmationToken, createdBundle.confirmationToken);
  assert.equal(await db.inventoryMovement.count(), movementsAfterBundle);
  await fail({ ...bundleInput, lines: [{ key: bundle.publicOfferId, quantity: 2 }] }, "CONFLICT");
  assert.equal((await confirmGuestOrder(createdBundle.order.reference, "")), null);
  assert.equal((await confirmGuestOrder(createdBundle.order.reference, "invalid")), null);
  assert.equal((await confirmGuestOrder(createdBundle.order.reference, createdBundle.confirmationToken))?.reference, createdBundle.order.reference);
  await db.storefrontOrder.update({ where: { reference: createdBundle.order.reference }, data: { confirmationUntil: new Date(Date.now() - 1000) } });
  assert.equal(await confirmGuestOrder(createdBundle.order.reference, createdBundle.confirmationToken), null);
  const standard = await createGuestOrder(input(blackEg.publicOfferId));
  assert.equal(standard.order.itemsSubtotal.amountMinor, 67900);
  assert.equal(standard.order.grandTotal.amountMinor, 72900);
  assert.notEqual(standard.order.reference, createdBundle.order.reference);
  const two = await Promise.allSettled([createGuestOrder(input(blackEg.publicOfferId)), createGuestOrder(input(blackEg.publicOfferId))]);
  assert.equal(two.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(two.filter(result => result.status === "rejected").length, 1);
  const morocco = await createGuestOrder(input(blackMa.publicOfferId, "MOROCCO"));
  assert.equal(morocco.order.currency, "MAD");
  assert.equal(morocco.order.itemsSubtotal.amountMinor, 79900);
  assert.equal(morocco.order.grandTotal.amountMinor, 81400);
  assert.match(morocco.order.reference, /^MTA-MA-[A-Z2-9]{12}$/);
  await db.marketListing.update({ where: { id: blackEg.id }, data: { price: 999 } });
  await db.product.update({ where: { id: blackEg.productId }, data: { nameEn: "Changed Name" } });
  const variant = await db.productVariant.findUniqueOrThrow({ where: { id: blackEg.variantId! } });
  await db.productVariant.update({ where: { id: variant.id }, data: { color: "Changed Color" } });
  const frozen = await db.storefrontOrder.findUniqueOrThrow({ where: { reference: standard.order.reference }, include: { lines: true } });
  assert.equal(frozen.lines[0].name, "Controller");
  assert.equal(frozen.lines[0].unitPrice.mul(100).toNumber(), 67900);
  assert.equal((frozen.lines[0].attributes as { color?: string }).color, "Black");
  const correct = await trackGuestOrder(standard.order.reference, "+201012345678", "test-client");
  assert.equal(correct.order?.reference, standard.order.reference);
  assert.equal(correct.order ? "detailedAddress" in correct.order.address : true, false);
  assert.equal((await trackGuestOrder(standard.order.reference, "01099999999", "test-client")).order, null);
  assert.equal((await trackGuestOrder("MTA-EG-AAAAAAAAAAAA", "01012345678", "test-client")).order, null);
  for (let i = 0; i < 7; i++) await trackGuestOrder(standard.order.reference, "01099999999", "test-client");
  assert.equal((await trackGuestOrder(standard.order.reference, "01012345678", "test-client")).limited, true);
  const publicText = JSON.stringify(createdBundle.order) + JSON.stringify(correct.order);
  for (const forbidden of ["cost", "supplier", "profit", "margin", "currentStock", "inventoryId", "idempotencyKey", "requestHash", "PRIVATE", "SECRET"]) assert.equal(publicText.includes(forbidden), false, forbidden);
  console.log("v1.2C guest order transaction checks passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
