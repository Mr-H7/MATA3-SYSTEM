import { NextRequest, NextResponse } from "next/server";
import { FulfillmentStatus } from "@prisma/client";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
const transitions: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  NOT_READY: [], READY_FOR_FULFILLMENT: ["MANUAL_FULFILLMENT", "FULFILLMENT_EXCEPTION"],
  MANUAL_FULFILLMENT: ["FULFILLED", "FULFILLMENT_EXCEPTION"], PROVIDER_PENDING: [],
  PROVIDER_CREATED: [], FULFILLED: [], FULFILLMENT_EXCEPTION: ["MANUAL_FULFILLMENT"],
};
export async function PATCH(request: NextRequest, context: { params: Promise<{ reference: string }> }) {
  let owner: Awaited<ReturnType<typeof requireOwner>>;
  try { owner = await requireOwner(); } catch { return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 }); }
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 }); }
  const status = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).status : null;
  if (typeof status !== "string" || !Object.values(FulfillmentStatus).includes(status as FulfillmentStatus))
    return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 });
  const { reference } = await context.params;
  if (!/^MTA-(EG|MA)-[A-Z2-9]{12}$/.test(reference)) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
  try {
    const order = await prisma.storefrontOrder.findUnique({ where: { reference } });
    if (!order) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
    if (order.status === "CANCELLED" || !transitions[order.fulfillmentStatus].includes(status as FulfillmentStatus))
      return NextResponse.json({ code: "INVALID_TRANSITION" }, { status: 409 });
    const changed = await prisma.$transaction(async tx => {
      const result = await tx.storefrontOrder.updateMany({ where: { id: order.id, fulfillmentStatus: order.fulfillmentStatus, status: { not: "CANCELLED" } },
        data: { fulfillmentStatus: status as FulfillmentStatus } });
      if (result.count !== 1) return false;
      await tx.auditLog.create({ data: { userId: owner.id, action: "STOREFRONT_FULFILLMENT_STATUS", entity: "StorefrontOrder",
        entityId: order.id, marketId: order.marketId, metadata: { from: order.fulfillmentStatus, to: status } } });
      return true;
    });
    return changed ? NextResponse.json({ reference, fulfillmentStatus: status }) : NextResponse.json({ code: "INVALID_TRANSITION" }, { status: 409 });
  } catch { return NextResponse.json({ code: "FULFILLMENT_UNAVAILABLE" }, { status: 503 }); }
}
