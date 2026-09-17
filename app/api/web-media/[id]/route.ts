import { NextResponse } from "next/server";
import { WebPublicationStatus } from "@prisma/client";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { removeWebMedia } from "@/lib/web-media-storage";
type Context = { params: Promise<{ id: string }> };
const denied = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
export async function PATCH(request: Request, { params }: Context) {
  try {
    await requireOwner();
    const { id } = await params, body = await request.json();
    const existing = await prisma.webProductMedia.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Media not found" }, { status: 404 });
    const data: { altText?: string; sortOrder?: number; isCover?: boolean; publicationStatus?: WebPublicationStatus } = {};
    if (body.altText !== undefined) {
      if (typeof body.altText !== "string" || body.altText.length > 300) return NextResponse.json({ error: "Invalid alt text" }, { status: 400 });
      data.altText = body.altText.trim();
    }
    if (body.sortOrder !== undefined) {
      if (!Number.isInteger(body.sortOrder) || body.sortOrder < 0 || body.sortOrder > 10000) return NextResponse.json({ error: "Invalid order" }, { status: 400 });
      data.sortOrder = body.sortOrder;
    }
    if (body.isCover !== undefined) {
      if (typeof body.isCover !== "boolean") return NextResponse.json({ error: "Invalid cover state" }, { status: 400 });
      data.isCover = body.isCover;
    }
    if (body.publicationStatus !== undefined) {
      if (!Object.values(WebPublicationStatus).includes(body.publicationStatus)) return NextResponse.json({ error: "Invalid publication state" }, { status: 400 });
      data.publicationStatus = body.publicationStatus;
    }
    const row = await prisma.$transaction(async tx => {
      if (data.isCover) await tx.webProductMedia.updateMany({
        where: { id: { not: id }, productId: existing.productId, variantId: existing.variantId, bundleId: existing.bundleId, isCover: true },
        data: { isCover: false },
      });
      return tx.webProductMedia.update({ where: { id }, data });
    });
    return NextResponse.json(row);
  } catch (error) { return error instanceof Error && ["UNAUTHENTICATED", "FORBIDDEN"].includes(error.message) ? denied() : NextResponse.json({ error: "Unable to update media" }, { status: 500 }); }
}
export async function DELETE(_request: Request, { params }: Context) {
  try {
    await requireOwner();
    const { id } = await params;
    const row = await prisma.webProductMedia.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: "Media not found" }, { status: 404 });
    await prisma.webProductMedia.delete({ where: { id } });
    await removeWebMedia(row.storageKey, row.url);
    return NextResponse.json({ ok: true });
  } catch (error) { return error instanceof Error && ["UNAUTHENTICATED", "FORBIDDEN"].includes(error.message) ? denied() : NextResponse.json({ error: "Unable to remove media" }, { status: 500 }); }
}
