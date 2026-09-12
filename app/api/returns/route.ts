import { randomUUID } from "node:crypto";
import { Prisma, ReturnCondition } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireOwner, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await requireUser();
  if (user.role !== "OWNER") return NextResponse.json({ error: "You do not have permission to perform this action" }, { status: 403 });
  const rows = await prisma.return.findMany({ include: { sale: true, market: true, createdBy: { select: { id: true, name: true } }, items: { include: { saleItem: true } } }, orderBy: { createdAt: "desc" } });
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const user = await requireOwner();
    const body = await request.json();
    if (!body.saleId || !Array.isArray(body.items) || !body.items.length) return NextResponse.json({ error: "Sale and return items are required" }, { status: 400 });
    const result = await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUniqueOrThrow({ where: { id: body.saleId }, include: { market: true, items: { include: { listing: { include: { inventory: true } }, returnItems: true } } } });
      let refund = new Prisma.Decimal(0);
      const creates: Array<{ saleItemId: string; quantity: number; unitPrice: Prisma.Decimal; condition: ReturnCondition }> = [];
      for (const input of body.items) {
        const item = sale.items.find((candidate) => candidate.id === input.saleItemId);
        const quantity = Number(input.quantity);
        if (!item || !Number.isInteger(quantity) || quantity <= 0) throw new Error("Invalid return item or quantity");
        const alreadyReturned = item.returnItems.reduce((sum, returnItem) => sum + returnItem.quantity, 0);
        if (quantity > item.quantity - alreadyReturned) throw new Error(`Return quantity exceeds remaining sold quantity for ${item.productName}`);
        const condition = input.condition as ReturnCondition;
        if (!Object.values(ReturnCondition).includes(condition)) throw new Error("Invalid return condition");
        creates.push({ saleItemId: item.id, quantity, unitPrice: item.unitPrice, condition });
        refund = refund.add(item.unitPrice.mul(quantity));
        if (condition === ReturnCondition.RESELLABLE) {
          const inventory = item.listing.inventory;
          if (!inventory) throw new Error(`No inventory exists for ${item.productName}`);
          const updated = await tx.inventory.update({ where: { id: inventory.id }, data: { currentStock: { increment: quantity } } });
          await tx.inventoryMovement.create({ data: { inventoryId: inventory.id, quantityChange: quantity, previousQuantity: updated.currentStock - quantity, newQuantity: updated.currentStock, reason: "RETURN", reference: sale.invoiceNumber, userId: user.id } });
        }
      }
      const row = await tx.return.create({ data: { returnNumber: `RET-${Date.now()}-${randomUUID().slice(0, 6)}`, saleId: sale.id, marketId: sale.marketId, createdById: user.id, reason: body.reason || null, refundAmount: refund, refundStatus: body.refundStatus || "REFUNDED", items: { create: creates } } });
      await tx.auditLog.create({ data: { userId: user.id, action: "RETURN_CREATE", entity: "Return", entityId: row.id, marketId: sale.marketId } });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result, { status: 201 });
  } catch (error) { const message=error instanceof Error?error.message:"Return failed";return NextResponse.json({ error: message==="FORBIDDEN"?"You do not have permission to perform this action":message }, { status: message==="FORBIDDEN"?403:400 }); }
}
