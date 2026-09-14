import { WebPublicationStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";

export async function GET() {
  try {
    await requireOwner();
    const rows = await prisma.marketListing.findMany({
      where: { product: { status: { not: "ARCHIVED" } } },
      include: {
        product: { include: { images: { where: { isPrimary: true }, take: 1 }, category: true } },
        variant: true,
        market: true,
        inventory: true,
        inventorySourceMarket: true,
      },
      orderBy: [{ product: { nameEn: "asc" } }, { market: { code: "asc" } }],
    });
    return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load web products";
    return NextResponse.json(
      { error: message === "FORBIDDEN" || message === "UNAUTHENTICATED" ? "You do not have permission to perform this action" : message },
      { status: message === "FORBIDDEN" || message === "UNAUTHENTICATED" ? 403 : 400 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireOwner();
    const body = await request.json();
    if (!body.listingId || !body.webPublicationStatus) return NextResponse.json({ error: "listingId and webPublicationStatus are required" }, { status: 400 });
    if (!Object.values(WebPublicationStatus).includes(body.webPublicationStatus)) return NextResponse.json({ error: "Invalid web publication status" }, { status: 400 });
    const listing = await prisma.$transaction(async (tx) => {
      const existing = await tx.marketListing.findUniqueOrThrow({
        where: { id: body.listingId },
        include: { product: true },
      });
      if (body.webPublicationStatus === WebPublicationStatus.PUBLISHED && !existing.product.publicSlug) {
        const base = slugify(existing.product.nameEn) || existing.product.sku.toLowerCase();
        const conflict = await tx.product.findFirst({ where: { publicSlug: base, id: { not: existing.productId } } });
        await tx.product.update({
          where: { id: existing.productId },
          data: { publicSlug: conflict ? `${base}-${existing.productId.slice(-6)}` : base },
        });
      }
      const updated = await tx.marketListing.update({
        where: { id: body.listingId },
        data: { webPublicationStatus: body.webPublicationStatus as WebPublicationStatus },
        select: { id: true, webPublicationStatus: true },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "WEB_PUBLICATION_CHANGE",
          entity: "MarketListing",
          entityId: existing.id,
          marketId: existing.marketId,
          metadata: {
            from: existing.webPublicationStatus,
            to: body.webPublicationStatus,
          },
        },
      });
      return updated;
    });
    return NextResponse.json(listing);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed";
    return NextResponse.json(
      { error: message === "FORBIDDEN" || message === "UNAUTHENTICATED" ? "You do not have permission to perform this action" : message },
      { status: message === "FORBIDDEN" || message === "UNAUTHENTICATED" ? 403 : 400 },
    );
  }
}
