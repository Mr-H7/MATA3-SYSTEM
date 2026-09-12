import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { canAccessMarket, requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const MODES = new Set(["ADD", "SUBTRACT", "SET", "CORRECT"]);
const REASONS = new Set(["PURCHASE", "SALE", "RETURN", "CORRECTION", "DAMAGE", "TRANSFER", "OTHER"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireOwner();
    const { id } = await params;
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    const input = body as Record<string, unknown>;
    const mode = String(input.mode ?? "").toUpperCase();
    const reason = String(input.reason ?? "").toUpperCase();
    const quantity = Number(input.quantity);
    if (!MODES.has(mode)) return NextResponse.json({ error: "Mode must be ADD, SUBTRACT, SET, or CORRECT" }, { status: 400 });
    if (!REASONS.has(reason)) return NextResponse.json({ error: "A valid inventory reason is required" }, { status: 400 });
    if (!Number.isInteger(quantity) || quantity < 0 || ((mode === "ADD" || mode === "SUBTRACT") && quantity === 0)) return NextResponse.json({ error: "Quantity must be a valid positive integer" }, { status: 400 });

    const result = await prisma.$transaction(async (tx) => {
      const inventory = await tx.inventory.findUniqueOrThrow({ where: { id }, include: { market: true } });
      if (!canAccessMarket(user, inventory.market.code)) throw new Error("MARKET_ACCESS_DENIED");
      const next = mode === "SET" || mode === "CORRECT" ? quantity : inventory.currentStock + (mode === "SUBTRACT" ? -quantity : quantity);
      if (next < 0) throw new Error("NEGATIVE_STOCK");
      await tx.inventory.update({ where: { id }, data: { currentStock: next } });
      const movement = await tx.inventoryMovement.create({ data: { inventoryId: id, quantityChange: next - inventory.currentStock, previousQuantity: inventory.currentStock, newQuantity: next, reason, reference: typeof input.reference === "string" && input.reference.trim() ? input.reference.trim() : null, userId: user.id } });
      await tx.auditLog.create({ data: { userId: user.id, action: "INVENTORY_ADJUSTMENT", entity: "Inventory", entityId: id, marketId: inventory.marketId, metadata: { mode, reason, previousQuantity: inventory.currentStock, newQuantity: next } } });
      return { inventoryId: id, previousQuantity: inventory.currentStock, newQuantity: next, movementId: movement.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Inventory adjustment failed";
    if (message === "MARKET_ACCESS_DENIED") return NextResponse.json({ error: "Market access denied" }, { status: 403 });
    if (message === "FORBIDDEN") return NextResponse.json({ error: "You do not have permission to perform this action" }, { status: 403 });
    if (message === "NEGATIVE_STOCK") return NextResponse.json({ error: "Resulting stock cannot be negative" }, { status: 409 });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
