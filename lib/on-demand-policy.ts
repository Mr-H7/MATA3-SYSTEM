import type { InventoryType, OnDemandApproval, OnDemandBasis } from "@prisma/client";

export type OnDemandListing = {
  available: boolean;
  inventoryType: InventoryType;
  onDemandApproval: OnDemandApproval;
  onDemandBasis: OnDemandBasis;
  onDemandMaxPerOrder: number | null;
};

export function approvedOnDemandPolicy(listing: OnDemandListing): { maxPerOrder: number } | null {
  if (listing.inventoryType !== "ON_DEMAND" || !listing.available) return null;
  if (listing.onDemandApproval !== "APPROVED") return null;
  if (listing.onDemandBasis !== "CONFIRMED_AVAILABILITY" && listing.onDemandBasis !== "APPROVED_FULFILLMENT_POLICY") return null;
  const max = listing.onDemandMaxPerOrder;
  if (!Number.isInteger(max) || max === null || max < 1 || max > 99) return null;
  return { maxPerOrder: max };
}

export function onDemandQuantityDecision(listing: OnDemandListing, quantity: number): "ok" | "UNAVAILABLE" | "INVALID_QUANTITY" {
  const policy = approvedOnDemandPolicy(listing);
  if (!policy) return "UNAVAILABLE";
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > policy.maxPerOrder) return "INVALID_QUANTITY";
  return "ok";
}
