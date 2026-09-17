import { NextResponse } from "next/server";
import { WebPublicationStatus } from "@prisma/client";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { storeWebMedia, removeWebMedia } from "@/lib/web-media-storage";
const denied = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const failed = () => NextResponse.json({ error: "Unable to manage media" }, { status: 500 });
function target(form: FormData) {
  const entries = ["productId", "variantId", "bundleId"].map(key => [key, form.get(key)?.toString() ?? ""] as const).filter(([, value]) => value);
  return entries.length === 1 ? { [entries[0][0]]: entries[0][1] } : null;
}
export async function GET() {
  try {
    await requireOwner();
    const [media, products, variants, bundles] = await Promise.all([
      prisma.webProductMedia.findMany({ orderBy: [{ createdAt: "desc" }] }),
      prisma.product.findMany({ select: { id: true, nameEn: true }, orderBy: { nameEn: "asc" } }),
      prisma.productVariant.findMany({ select: { id: true, productId: true, color: true, size: true }, orderBy: { id: "asc" } }),
      prisma.bundle.findMany({ select: { id: true, name: true, publicSlug: true, status: true, listings: { select: { id: true, marketId: true, webPublicationStatus: true, market: { select: { code: true } } } } }, orderBy: { name: "asc" } }),
    ]);
    return NextResponse.json({ media, products, variants, bundles }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return error instanceof Error && ["UNAUTHENTICATED", "FORBIDDEN"].includes(error.message) ? denied() : failed(); }
}
export async function POST(request: Request) {
  try {
    await requireOwner();
    const form = await request.formData(), file = form.get("file"), relation = target(form);
    if (!(file instanceof File) || !relation) return NextResponse.json({ error: "One target and a file are required" }, { status: 400 });
    const [key, id] = Object.entries(relation)[0];
    const exists = key === "productId" ? await prisma.product.count({ where: { id } }) : key === "variantId" ? await prisma.productVariant.count({ where: { id } }) : await prisma.bundle.count({ where: { id } });
    if (!exists) return NextResponse.json({ error: "Target not found" }, { status: 404 });
    const altText = form.get("altText")?.toString().trim() ?? "";
    if (altText.length > 300) return NextResponse.json({ error: "Alt text is too long" }, { status: 400 });
    const stored = await storeWebMedia(file);
    try {
      const row = await prisma.webProductMedia.create({ data: { ...relation, ...stored, altText, publicationStatus: WebPublicationStatus.DRAFT } });
      return NextResponse.json(row, { status: 201 });
    } catch (error) { await removeWebMedia(stored.storageKey, stored.url); throw error; }
  } catch (error) {
    if (error instanceof Error && ["UNAUTHENTICATED", "FORBIDDEN"].includes(error.message)) return denied();
    if (error instanceof Error && error.message === "Invalid media file") return NextResponse.json({ error: error.message }, { status: 400 });
    return failed();
  }
}
