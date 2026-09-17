import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { createSessionValue, COOKIE_NAME } from "../lib/auth";
const db = new PrismaClient();
async function main() {
  if (!process.env.DATABASE_URL?.includes("/mata3_catalogue_v12a_test")) throw new Error("Test database required");
  const product = await db.product.findUniqueOrThrow({ where: { publicSlug: "controller" } });
  const owner = await db.user.create({ data: { name: "Media Test", email: "media-test@local.test", passwordHash: "test-only", role: "OWNER" } });
  const cookie = COOKIE_NAME + "=" + createSessionValue(owner.id);
  let mediaId: string | null = null;
  try {
    const form = new FormData();
    form.set("productId", product.id);
    form.set("altText", "Customer image");
    const bytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64"));
    form.set("file", new File([bytes], "customer.png", { type: "image/png" }));
    const created = await fetch("http://localhost:3101/api/web-media", { method: "POST", headers: { cookie }, body: form });
    assert.equal(created.status, 201);
    const row = await created.json();
    mediaId = row.id;
    assert.equal(row.publicationStatus, "DRAFT");
    assert.equal(row.type, "IMAGE");
    let detail = await (await fetch("http://localhost:3101/api/public/v1/products/controller?market=EGYPT")).json();
    assert.equal(detail.media.some((item: { altText: string }) => item.altText === "Customer image"), false);
    const patched = await fetch("http://localhost:3101/api/web-media/" + mediaId, { method: "PATCH", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ publicationStatus: "PUBLISHED", isCover: true, sortOrder: 2, altText: "Customer cover" }) });
    assert.equal(patched.status, 200);
    detail = await (await fetch("http://localhost:3101/api/public/v1/products/controller?market=EGYPT")).json();
    assert.equal(detail.media[0].altText, "Customer cover");
    assert.equal(detail.media[0].sortOrder, 2);
    const denied = await fetch("http://localhost:3101/api/web-media", { redirect: "manual" });
    assert.ok([302,307,308,403].includes(denied.status));
    console.log("owner web media flow passed");
  } finally {
    if (mediaId) await fetch("http://localhost:3101/api/web-media/" + mediaId, { method: "DELETE", headers: { cookie } });
    await db.user.delete({ where: { id: owner.id } });
    await db.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
