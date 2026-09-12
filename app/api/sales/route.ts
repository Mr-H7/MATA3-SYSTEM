import { randomUUID } from "node:crypto";
import { InventoryType, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { canAccessMarket, isSeller, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type SaleInput = { listingId?: string; bundleId?: string; quantity: number };
type Deduction = { inventoryId: string; productName: string; quantity: number; previousQuantity: number; availableQuantity: number; reference?: string };
type Snapshot = { productId: string; variantId: string | null; listingId: string; sku: string; productName: string; variantLabel: string | null; quantity: number; unitPrice: Prisma.Decimal; unitCost: Prisma.Decimal; lineTotal: Prisma.Decimal; marketCode: string; currency: string };
const PAYMENT_METHODS = new Set(["Cash", "InstaPay", "Vodafone Cash", "Card", "Bank Transfer", "Cash on Delivery"]);
const PAYMENT_STATUSES = new Set(["PENDING", "PAID", "PARTIAL"]);

export async function POST(request: Request) {
  try {
    const user = await requireUser(); const body = await request.json();
    const market = await prisma.market.findUniqueOrThrow({ where: { code: body.marketCode } });
    if (!canAccessMarket(user, market.code)) return NextResponse.json({ error: "Market access denied" }, { status: 403 });
    const inputs = body.items as SaleInput[];
    if (!Array.isArray(inputs) || !inputs.length) return NextResponse.json({ error: "At least one sale item is required" }, { status: 400 });
    if (inputs.some((input) => !Number.isInteger(Number(input.quantity)) || Number(input.quantity) <= 0 || (!input.listingId && !input.bundleId) || (input.listingId && input.bundleId))) return NextResponse.json({ error: "Each item requires either a listing or bundle and a positive integer quantity" }, { status: 400 });
    const discount = Number(body.discount ?? 0); const shipping = Number(body.shipping ?? 0);
    if (!Number.isFinite(discount) || !Number.isFinite(shipping) || discount < 0 || shipping < 0) return NextResponse.json({ error: "Discount and shipping must be non-negative" }, { status: 400 });
    if (isSeller(user) && discount !== 0) return NextResponse.json({ error: "Manual discounts require owner authorization" }, { status: 403 });
    if (!PAYMENT_METHODS.has(body.paymentMethod) || !PAYMENT_STATUSES.has(body.paymentStatus)) return NextResponse.json({ error: "Invalid payment method or payment status" }, { status: 400 });

    const sale = await prisma.$transaction(async (tx) => {
      const deductions: Deduction[] = []; const snapshots: Snapshot[] = []; let subtotal = new Prisma.Decimal(0);
      for (const input of inputs) {
        const saleQuantity = Number(input.quantity);
        if (input.listingId) {
          const listing = await tx.marketListing.findFirstOrThrow({ where: { id: input.listingId, marketId: market.id, available: true }, include: { product: true, variant: true, inventory: true } });
          if (listing.product.status !== "ACTIVE") throw new Error(`${listing.product.nameEn} is not active for sale`);
          if (listing.inventoryType === InventoryType.PHYSICAL_STOCK) { if (!listing.inventory || listing.inventory.currentStock - listing.inventory.reservedStock < saleQuantity) throw new Error(`Insufficient stock for ${listing.product.nameEn}`); deductions.push({ inventoryId: listing.inventory.id, productName: listing.product.nameEn, quantity: saleQuantity, previousQuantity: listing.inventory.currentStock, availableQuantity: listing.inventory.currentStock-listing.inventory.reservedStock }); }
          const lineTotal = listing.price.mul(saleQuantity); subtotal = subtotal.add(lineTotal);
          snapshots.push({ productId: listing.productId, variantId: listing.variantId, listingId: listing.id, sku: listing.variant?.sku || listing.product.sku, productName: listing.product.nameEn, variantLabel: [listing.variant?.color, listing.variant?.size].filter(Boolean).join(" / ") || null, quantity: saleQuantity, unitPrice: listing.price, unitCost: listing.cost, lineTotal, marketCode: market.code, currency: market.currency });
          continue;
        }

        const bundle = await tx.bundle.findFirstOrThrow({ where: { id: input.bundleId, status: "ACTIVE" }, include: { items: true, listings: { where: { marketId: market.id } } } });
        const bundleListing = bundle.listings[0]; if (!bundleListing) throw new Error(`${bundle.name} is not configured for ${market.name}`); if (!bundle.items.length) throw new Error(`${bundle.name} has no components`);
        const componentLabels: string[] = []; let snapshotBase: { productId: string; variantId: string | null; listingId: string } | null = null;
        for (const component of bundle.items) {
          const componentListing = await tx.marketListing.findFirstOrThrow({ where: { marketId: market.id, productId: component.productId ?? undefined, variantId: component.variantId ?? null, available: true }, include: { product: true, variant: true, inventory: true } });
          const required = saleQuantity * component.quantity; componentLabels.push(`${required}× ${componentListing.product.nameEn}${componentListing.variant ? ` (${componentListing.variant.sku})` : ""}`);
          snapshotBase ??= { productId: componentListing.productId, variantId: componentListing.variantId, listingId: componentListing.id };
          if (componentListing.inventoryType === InventoryType.PHYSICAL_STOCK) { if (!componentListing.inventory || componentListing.inventory.currentStock - componentListing.inventory.reservedStock < required) throw new Error(`Insufficient stock for bundle component ${componentListing.product.nameEn}`); deductions.push({ inventoryId: componentListing.inventory.id, productName: componentListing.product.nameEn, quantity: required, previousQuantity: componentListing.inventory.currentStock, availableQuantity: componentListing.inventory.currentStock-componentListing.inventory.reservedStock, reference: `Bundle ${bundle.name}` }); }
        }
        if (!snapshotBase) throw new Error(`${bundle.name} has no resolvable components`);
        const lineTotal = bundleListing.price.mul(saleQuantity); subtotal = subtotal.add(lineTotal);
        snapshots.push({ ...snapshotBase, sku: `BUNDLE-${bundle.id}`, productName: bundle.name, variantLabel: componentLabels.join("; "), quantity: saleQuantity, unitPrice: bundleListing.price, unitCost: bundleListing.cost, lineTotal, marketCode: market.code, currency: market.currency });
      }

      const grouped=new Map<string,Deduction>(); for(const deduction of deductions){const prior=grouped.get(deduction.inventoryId);if(prior)prior.quantity+=deduction.quantity;else grouped.set(deduction.inventoryId,{...deduction});}
      for(const deduction of grouped.values())if(deduction.quantity>deduction.availableQuantity)throw new Error(`Insufficient stock for ${deduction.productName}`);
      for (const deduction of grouped.values()) { const updated = await tx.inventory.update({ where: { id: deduction.inventoryId }, data: { currentStock: { decrement: deduction.quantity } } }); await tx.inventoryMovement.create({ data: { inventoryId: deduction.inventoryId, quantityChange: -deduction.quantity, previousQuantity: deduction.previousQuantity, newQuantity: updated.currentStock, reason: "SALE", reference: deduction.reference, userId: user.id } }); }
      if (new Prisma.Decimal(discount).greaterThan(subtotal)) throw new Error("Discount cannot exceed subtotal"); const total = subtotal.sub(discount).add(shipping);
      if (body.customerId) await tx.customer.findFirstOrThrow({ where: { id: body.customerId, marketId: market.id } });
      const created = await tx.sale.create({ data: { invoiceNumber: `M3-${Date.now()}-${randomUUID().slice(0, 8)}`, marketId: market.id, customerId: body.customerId || null, customerName: body.customerName || null, customerPhone: body.customerPhone || null, subtotal, discount: new Prisma.Decimal(discount), shipping: new Prisma.Decimal(shipping), total, paymentMethod: body.paymentMethod, paymentStatus: body.paymentStatus, status: "CONFIRMED", notes: body.notes || null, createdById: user.id, items: { create: snapshots } } });
      await tx.auditLog.create({ data: { userId: user.id, action: "SALE_CREATE", entity: "Sale", entityId: created.id, marketId: market.id } }); return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(sale, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sale failed" }, { status: 400 }); }
}
