import { OnDemandApproval, OnDemandBasis } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const bases = [OnDemandBasis.CONFIRMED_AVAILABILITY, OnDemandBasis.APPROVED_FULFILLMENT_POLICY] as const;

export async function PATCH(request: Request) {
  try {
    const user = await requireOwner();
    const body = await request.json() as Record<string, unknown>;
    const listingId = typeof body.listingId === "string" ? body.listingId : "";
    const approval = body.approval;
    const basis = body.basis;
    const maxPerOrder = body.maxPerOrder;
    if (!listingId || (approval !== OnDemandApproval.APPROVED && approval !== OnDemandApproval.UNAPPROVED)) {
      return NextResponse.json({ error: "listingId and approval are required" }, { status: 400 });
    }
    if (approval === OnDemandApproval.APPROVED) {
      if (!bases.includes(basis as typeof bases[number]) || !Number.isInteger(maxPerOrder) || (maxPerOrder as number) < 1 || (maxPerOrder as number) > 99) {
        return NextResponse.json({ error: "Approved on-demand policy requires a fulfillment basis and a per-order maximum from 1 to 99" }, { status: 400 });
      }
    }
    const listing = await prisma.$transaction(async tx => {
      const existing = await tx.marketListing.findUnique({ where: { id: listingId }, include: { product: true } });
      if (!existing || existing.inventoryType !== "ON_DEMAND") return null;
      const data = approval === OnDemandApproval.APPROVED
        ? { onDemandApproval: OnDemandApproval.APPROVED, onDemandBasis: basis as OnDemandBasis, onDemandMaxPerOrder: maxPerOrder as number }
        : { onDemandApproval: OnDemandApproval.UNAPPROVED, onDemandBasis: OnDemandBasis.NONE, onDemandMaxPerOrder: null };
      const updated = await tx.marketListing.update({
        where: { id: existing.id },
        data,
        select: { id: true, onDemandApproval: true, onDemandBasis: true, onDemandMaxPerOrder: true, webPublicationStatus: true },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id, action: "ON_DEMAND_POLICY", entity: "MarketListing", entityId: existing.id, marketId: existing.marketId,
          metadata: { from: existing.onDemandApproval, to: updated.onDemandApproval, basis: updated.onDemandBasis, maxPerOrder: updated.onDemandMaxPerOrder },
        },
      });
      return updated;
    });
    if (!listing) return NextResponse.json({ error: "On-demand listing not found" }, { status: 404 });
    return NextResponse.json(listing);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed";
    const denied = message === "FORBIDDEN" || message === "UNAUTHENTICATED";
    return NextResponse.json({ error: denied ? "You do not have permission to perform this action" : "Unable to update on-demand policy" }, { status: denied ? 403 : 400 });
  }
}
