import { NextRequest, NextResponse } from "next/server";
import { StorefrontOrderStatus } from "@prisma/client";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
const next: Record<StorefrontOrderStatus, StorefrontOrderStatus[]> = {
  RECEIVED: ["PROCESSING", "CANCELLED"], PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"], DELIVERED: [], CANCELLED: [],
};
export async function PATCH(request: NextRequest, context: { params: Promise<{ reference: string }> }) {
  let user: Awaited<ReturnType<typeof requireOwner>>;
  try { user = await requireOwner(); } catch { return NextResponse.json({ error: "Not authorized" }, { status: 403 }); }
  const { reference } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid status" }, { status: 400 }); }
  const status = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).status : null;
  if (!Object.values(StorefrontOrderStatus).includes(status as StorefrontOrderStatus)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  try {
    const order = await prisma.storefrontOrder.findUnique({ where: { reference } });
    if (!order || !next[order.status].includes(status as StorefrontOrderStatus)) return NextResponse.json({ error: "Invalid transition" }, { status: 409 });
    const updated = await prisma.$transaction(async tx => {
      const changed = await tx.storefrontOrder.updateMany({ where: { id: order.id, status: order.status }, data: { status: status as StorefrontOrderStatus } });
      if (changed.count !== 1) return false;
      if (status === "CANCELLED") {
        const lines = await tx.storefrontOrderLine.findMany({ where: { orderId: order.id }, include: { allocations: true } });
        const restocks = new Map<string, number>();
        for (const line of lines) for (const allocation of line.allocations) {
          restocks.set(allocation.inventoryId, (restocks.get(allocation.inventoryId) ?? 0) + allocation.quantityPerOrderUnit * line.quantity);
        }
        for (const [inventoryId, quantity] of restocks) {
          const inventory = await tx.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
          const updated = await tx.inventory.update({ where: { id: inventoryId }, data: { currentStock: { increment: quantity } } });
          await tx.inventoryMovement.create({ data: {
            inventoryId, quantityChange: quantity, previousQuantity: inventory.currentStock,
            newQuantity: updated.currentStock, reason: "STOREFRONT_CANCEL", reference: order.reference, userId: user.id,
          } });
        }
      }
      await tx.auditLog.create({ data: { userId: user.id, action: "STOREFRONT_ORDER_STATUS", entity: "StorefrontOrder", entityId: order.id, marketId: order.marketId } });
      return true;
    });
    return updated ? NextResponse.json({ reference, status }) : NextResponse.json({ error: "Invalid transition" }, { status: 409 });
  } catch { return NextResponse.json({ error: "Unable to update status" }, { status: 503 }); }
}
