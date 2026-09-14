import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { COOKIE_NAME, createSessionValue } from "../lib/auth";
import { deleteProductImage } from "../lib/product-image-upload";

const prisma = new PrismaClient();
const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3100";
const stamp = `QA-${Date.now()}`;
const createdProductIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdSaleIds: string[] = [];
const createdBundleIds: string[] = [];
const createdReturnIds: string[] = [];
const createdImages: Array<{ productId: string; url: string }> = [];

async function request(
  path: string,
  cookie: string | null,
  init?: RequestInit,
) {
  const headers = new Headers(init?.headers);
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function cleanup() {
  const sales = await prisma.sale.findMany({
    where: { id: { in: createdSaleIds } },
    include: { items: { select: { id: true } }, returns: { select: { id: true } } },
  });
  const saleItemIds = sales.flatMap((sale) => sale.items.map((item) => item.id));
  const returnIds = sales.flatMap((sale) => sale.returns.map((row) => row.id));
  const inventories = await prisma.inventory.findMany({
    where: { listing: { productId: { in: createdProductIds } } },
    select: { id: true },
  });
  const inventoryIds = inventories.map((inventory) => inventory.id);
  const listingIds = await prisma.marketListing.findMany({
    where: { productId: { in: createdProductIds } },
    select: { id: true },
  });

  await Promise.all(createdImages.map((image) => deleteProductImage(image.url, image.productId)));
  await prisma.returnItem.deleteMany({ where: { returnId: { in: returnIds } } });
  await prisma.return.deleteMany({ where: { id: { in: returnIds } } });
  await prisma.saleItemInventoryAllocation.deleteMany({ where: { saleItemId: { in: saleItemIds } } });
  await prisma.saleItem.deleteMany({ where: { id: { in: saleItemIds } } });
  await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
  await prisma.inventoryMovement.deleteMany({ where: { inventoryId: { in: inventoryIds } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { entityId: { in: createdProductIds } },
        { entityId: { in: createdSaleIds } },
        { entityId: { in: createdBundleIds } },
        { entityId: { in: createdReturnIds } },
        { entityId: { in: listingIds.map((listing) => listing.id) } },
      ],
    },
  });
  await prisma.bundleMarketListing.deleteMany({ where: { bundleId: { in: createdBundleIds } } });
  await prisma.bundleItem.deleteMany({ where: { bundleId: { in: createdBundleIds } } });
  await prisma.bundle.deleteMany({ where: { id: { in: createdBundleIds } } });
  await prisma.inventory.deleteMany({ where: { id: { in: inventoryIds } } });
  await prisma.marketListing.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.productImage.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.productVariant.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
}

async function main() {
  const [owner, seller, womenDepartment] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { role: "OWNER", active: true } }),
    prisma.user.findFirstOrThrow({ where: { role: "SELLER", marketScope: "MOROCCO", active: true } }),
    prisma.department.findUniqueOrThrow({ where: { name: "Women's Fashion" } }),
  ]);
  const ownerCookie = `${COOKIE_NAME}=${createSessionValue(owner.id)}`;
  const sellerCookie = `${COOKIE_NAME}=${createSessionValue(seller.id)}`;

  const top = await request("/api/categories", ownerCookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `${stamp} Fashion`, departmentId: womenDepartment.id }),
  });
  assert.equal(top.response.status, 201);
  createdCategoryIds.push(top.payload.id);

  const child = await request("/api/categories", ownerCookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `${stamp} Shoes`,
      departmentId: womenDepartment.id,
      parentId: top.payload.id,
    }),
  });
  assert.equal(child.response.status, 201);
  createdCategoryIds.push(child.payload.id);

  const selfParent = await request(`/api/categories/${top.payload.id}`, ownerCookie, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `${stamp} Fashion`,
      departmentId: womenDepartment.id,
      parentId: top.payload.id,
    }),
  });
  assert.equal(selfParent.response.status, 400);

  const cycle = await request(`/api/categories/${top.payload.id}`, ownerCookie, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `${stamp} Fashion`,
      departmentId: womenDepartment.id,
      parentId: child.payload.id,
    }),
  });
  assert.equal(cycle.response.status, 400);

  const sizes = ["37", "38", "39", "40", "41"];
  const variants = sizes.map((size) => ({
    sku: `${stamp}-${size}`,
    color: "Black",
    size,
    material: "",
    supplierCode: "",
    barcode: "",
  }));
  const listings = sizes.flatMap((size) => [
    {
      marketCode: "EGYPT",
      variantSku: `${stamp}-${size}`,
      cost: 100,
      price: 649,
      available: true,
      inventoryType: "PHYSICAL_STOCK",
      minimumStock: 0,
      stock: 7,
      inventorySourceMarketCode: "MOROCCO",
    },
    {
      marketCode: "MOROCCO",
      variantSku: `${stamp}-${size}`,
      cost: 110,
      price: 799,
      available: true,
      inventoryType: "PHYSICAL_STOCK",
      minimumStock: 0,
      stock: 5,
      inventorySourceMarketCode: "EGYPT",
    },
  ]);
  const productCreate = await request("/api/products", ownerCookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sku: stamp,
      nameAr: `حذاء ${stamp}`,
      nameEn: `${stamp} Shoe`,
      departmentId: womenDepartment.id,
      categoryId: child.payload.id,
      gender: "WOMEN",
      status: "ACTIVE",
      variants,
      listings,
    }),
  });
  assert.equal(productCreate.response.status, 201, JSON.stringify(productCreate.payload));
  createdProductIds.push(productCreate.payload.id);

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productCreate.payload.id },
    include: {
      variants: true,
      listings: { include: { market: true, inventory: true, inventorySourceMarket: true } },
    },
  });
  assert.deepEqual(product.variants.map((variant) => variant.size).sort(), sizes);
  assert.equal(new Set(product.listings.map((listing) => listing.variantId)).size, 5);

  const size40 = product.variants.find((variant) => variant.size === "40")!;
  const size41 = product.variants.find((variant) => variant.size === "41")!;
  const egypt40 = product.listings.find((listing) => listing.market.code === "EGYPT" && listing.variantId === size40.id)!;
  const morocco40 = product.listings.find((listing) => listing.market.code === "MOROCCO" && listing.variantId === size40.id)!;
  const egypt41 = product.listings.find((listing) => listing.market.code === "EGYPT" && listing.variantId === size41.id)!;
  const morocco41 = product.listings.find((listing) => listing.market.code === "MOROCCO" && listing.variantId === size41.id)!;

  const unauthorizedUpload = await request(`/api/products/${product.id}/images`, sellerCookie, {
    method: "POST",
    body: new FormData(),
  });
  assert.equal(unauthorizedUpload.response.status, 403);

  if (process.env.SKIP_IMAGE_UPLOAD !== "1") {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const imageForm = new FormData();
    imageForm.set("file", new File([png], `${stamp}.png`, { type: "image/png" }));
    const imageUpload = await request(`/api/products/${product.id}/images`, ownerCookie, {
      method: "POST",
      body: imageForm,
    });
    assert.equal(imageUpload.response.status, 201, JSON.stringify(imageUpload.payload));
    createdImages.push({ productId: product.id, url: imageUpload.payload.url });
  }

  const egyptSale = await request("/api/sales", ownerCookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      marketCode: "EGYPT",
      items: [{ listingId: egypt40.id, quantity: 2 }],
      discount: 0,
      shipping: 0,
      paymentMethod: "Cash",
      paymentStatus: "PAID",
    }),
  });
  assert.equal(egyptSale.response.status, 201, JSON.stringify(egyptSale.payload));
  createdSaleIds.push(egyptSale.payload.id);
  const egyptSaleRow = await prisma.sale.findUniqueOrThrow({
    where: { id: egyptSale.payload.id },
    include: { items: { include: { inventoryAllocations: true } } },
  });
  assert.equal(egyptSaleRow.marketId, egypt40.marketId);
  assert.equal(Number(egyptSaleRow.total), 1298);
  assert.equal(egyptSaleRow.items[0].currency, "EGP");
  assert.equal(egyptSaleRow.items[0].inventorySourceMarketCode, "MOROCCO");
  assert.equal(egyptSaleRow.items[0].inventoryAllocations[0].inventoryId, morocco40.inventory!.id);
  assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { id: morocco40.inventory!.id } })).currentStock, 3);
  assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { id: egypt40.inventory!.id } })).currentStock, 7);

  const oversell = await request("/api/sales", ownerCookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      marketCode: "EGYPT",
      items: [{ listingId: egypt40.id, quantity: 99 }],
      discount: 0,
      shipping: 0,
      paymentMethod: "Cash",
      paymentStatus: "PAID",
    }),
  });
  assert.equal(oversell.response.status, 400);
  assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { id: morocco40.inventory!.id } })).currentStock, 3);

  const resellable = await request("/api/returns", ownerCookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      saleId: egyptSaleRow.id,
      refundStatus: "REFUNDED",
      items: [{ saleItemId: egyptSaleRow.items[0].id, quantity: 1, condition: "RESELLABLE" }],
    }),
  });
  assert.equal(resellable.response.status, 201, JSON.stringify(resellable.payload));
  createdReturnIds.push(resellable.payload.id);
  assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { id: morocco40.inventory!.id } })).currentStock, 4);

  const damaged = await request("/api/returns", ownerCookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      saleId: egyptSaleRow.id,
      refundStatus: "REFUNDED",
      items: [{ saleItemId: egyptSaleRow.items[0].id, quantity: 1, condition: "DAMAGED" }],
    }),
  });
  assert.equal(damaged.response.status, 201, JSON.stringify(damaged.payload));
  createdReturnIds.push(damaged.payload.id);
  assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { id: morocco40.inventory!.id } })).currentStock, 4);

  const moroccoSale = await request("/api/sales", ownerCookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      marketCode: "MOROCCO",
      items: [{ listingId: morocco41.id, quantity: 2 }],
      discount: 0,
      shipping: 0,
      paymentMethod: "Cash",
      paymentStatus: "PAID",
    }),
  });
  assert.equal(moroccoSale.response.status, 201, JSON.stringify(moroccoSale.payload));
  createdSaleIds.push(moroccoSale.payload.id);
  const moroccoSaleRow = await prisma.sale.findUniqueOrThrow({ where: { id: moroccoSale.payload.id }, include: { items: true } });
  assert.equal(moroccoSaleRow.items[0].currency, "MAD");
  assert.equal(moroccoSaleRow.items[0].inventorySourceMarketCode, "EGYPT");
  assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { id: egypt41.inventory!.id } })).currentStock, 5);
  assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { id: morocco41.inventory!.id } })).currentStock, 5);

  const bundleCreate = await request("/api/bundles", ownerCookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `${stamp} Bundle`,
      status: "ACTIVE",
      items: [{ variantId: size40.id, quantity: 2 }],
      listings: [{ marketCode: "EGYPT", cost: 200, individualTotal: 1298, price: 1200 }],
    }),
  });
  assert.equal(bundleCreate.response.status, 201, JSON.stringify(bundleCreate.payload));
  createdBundleIds.push(bundleCreate.payload.id);
  const bundleSale = await request("/api/sales", ownerCookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      marketCode: "EGYPT",
      items: [{ bundleId: bundleCreate.payload.id, quantity: 1 }],
      discount: 0,
      shipping: 0,
      paymentMethod: "Cash",
      paymentStatus: "PAID",
    }),
  });
  assert.equal(bundleSale.response.status, 201, JSON.stringify(bundleSale.payload));
  createdSaleIds.push(bundleSale.payload.id);
  const bundleSaleRow = await prisma.sale.findUniqueOrThrow({
    where: { id: bundleSale.payload.id },
    include: { items: { include: { inventoryAllocations: true } } },
  });
  assert.equal(bundleSaleRow.items[0].inventoryAllocations[0].quantityPerSaleUnit, 2);
  assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { id: morocco40.inventory!.id } })).currentStock, 2);
  const bundleReturn = await request("/api/returns", ownerCookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      saleId: bundleSaleRow.id,
      refundStatus: "REFUNDED",
      items: [{ saleItemId: bundleSaleRow.items[0].id, quantity: 1, condition: "RESELLABLE" }],
    }),
  });
  assert.equal(bundleReturn.response.status, 201, JSON.stringify(bundleReturn.payload));
  createdReturnIds.push(bundleReturn.payload.id);
  assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { id: morocco40.inventory!.id } })).currentStock, 4);

  const sellerMorocco = await request("/api/catalogue?market=MOROCCO", sellerCookie);
  assert.equal(sellerMorocco.response.status, 200);
  assert.equal(JSON.stringify(sellerMorocco.payload).includes("inventorySourceMarket"), false);
  assert.equal(JSON.stringify(sellerMorocco.payload).includes("\"cost\""), false);
  const sellerEgypt = await request("/api/catalogue?market=EGYPT", sellerCookie);
  assert.equal(sellerEgypt.response.status, 403);

  const publish = await request("/api/web-products", ownerCookie, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ listingId: egypt40.id, webPublicationStatus: "PUBLISHED" }),
  });
  assert.equal(publish.response.status, 200);
  const publicEgypt = await request("/api/public/products?market=EGYPT", null);
  assert.equal(publicEgypt.response.status, 200);
  const publicItem = publicEgypt.payload.items.find((item: { id: string }) => item.id === product.id);
  assert.ok(publicItem);
  const serializedPublicItem = JSON.stringify(publicItem);
  for (const forbidden of ["cost", "supplier", "inventorySource", "internalNotes", "margin"]) {
    assert.equal(serializedPublicItem.includes(forbidden), false);
  }
  const publicMorocco = await request("/api/public/products?market=MOROCCO", null);
  assert.equal(publicMorocco.payload.items.some((item: { id: string }) => item.id === product.id), false);

  const hide = await request("/api/web-products", ownerCookie, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ listingId: egypt40.id, webPublicationStatus: "HIDDEN" }),
  });
  assert.equal(hide.response.status, 200);
  const hiddenEgypt = await request("/api/public/products?market=EGYPT", null);
  assert.equal(hiddenEgypt.payload.items.some((item: { id: string }) => item.id === product.id), false);

  console.log("Commerce upgrade integration verification passed.");
}

main()
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
