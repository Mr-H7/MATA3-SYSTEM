import { NextResponse } from "next/server";
import { WebPublicationStatus } from "@prisma/client";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";
export async function PATCH(request: Request) {
  try {
    await requireOwner();
    const body = await request.json();
    if (typeof body.listingId !== "string" || !Object.values(WebPublicationStatus).includes(body.webPublicationStatus)) return NextResponse.json({ error: "Invalid publication request" }, { status: 400 });
    const listing = await prisma.bundleMarketListing.findUnique({ where: { id: body.listingId }, include: { bundle: true } });
    if (!listing) return NextResponse.json({ error: "Bundle listing not found" }, { status: 404 });
    const updated = await prisma.$transaction(async tx => {
      if (body.webPublicationStatus === WebPublicationStatus.PUBLISHED && !listing.bundle.publicSlug) {
        const base = slugify(listing.bundle.name) || "bundle";
        await tx.bundle.update({ where: { id: listing.bundleId }, data: { publicSlug: base + "-" + listing.bundleId.slice(-6) } });
      }
      return tx.bundleMarketListing.update({ where: { id: listing.id }, data: { webPublicationStatus: body.webPublicationStatus }, select: { id: true, webPublicationStatus: true } });
    });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && ["UNAUTHENTICATED", "FORBIDDEN"].includes(error.message) ? "Forbidden" : "Unable to update bundle" }, { status: error instanceof Error && ["UNAUTHENTICATED", "FORBIDDEN"].includes(error.message) ? 403 : 500 });
  }
}
