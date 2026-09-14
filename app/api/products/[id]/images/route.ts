import { NextResponse } from "next/server";
import { canManageGlobalData, requireUser } from "@/lib/auth";
import { deleteProductImage, storeProductImage } from "@/lib/product-image-upload";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    if (!canManageGlobalData(user.role)) return NextResponse.json({ error: "You do not have permission to perform this action" }, { status: 403 });
    const { id } = await params;
    await prisma.product.findUniqueOrThrow({ where: { id } });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });
    const url = await storeProductImage(file, id);
    const image = await prisma.$transaction(async (tx) => {
      await tx.productImage.updateMany({ where: { productId: id, isPrimary: true }, data: { isPrimary: false } });
      return tx.productImage.create({ data: { productId: id, url, alt: form.get("alt")?.toString() || null, isPrimary: true, sortOrder: 0 } });
    });
    return NextResponse.json(image, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json(
      { error: message === "FORBIDDEN" || message === "UNAUTHENTICATED" ? "You do not have permission to perform this action" : message },
      { status: message === "FORBIDDEN" || message === "UNAUTHENTICATED" ? 403 : 400 },
    );
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    if (!canManageGlobalData(user.role)) return NextResponse.json({ error: "You do not have permission to perform this action" }, { status: 403 });
    const { id: productId } = await params;
    const body = await request.json();
    if (!body.imageId) return NextResponse.json({ error: "imageId is required" }, { status: 400 });
    const image = await prisma.productImage.findFirstOrThrow({ where: { id: body.imageId, productId } });
    await deleteProductImage(image.url, productId);
    await prisma.$transaction(async (tx) => {
      await tx.productImage.delete({ where: { id: image.id } });
      if (image.isPrimary) {
        const replacement = await tx.productImage.findFirst({
          where: { productId },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        });
        if (replacement) {
          await tx.productImage.update({ where: { id: replacement.id }, data: { isPrimary: true } });
        }
      }
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delete failed";
    return NextResponse.json(
      { error: message === "FORBIDDEN" || message === "UNAUTHENTICATED" ? "You do not have permission to perform this action" : message },
      { status: message === "FORBIDDEN" || message === "UNAUTHENTICATED" ? 403 : 400 },
    );
  }
}
