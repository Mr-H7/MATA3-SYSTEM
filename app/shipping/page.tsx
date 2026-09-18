import { requireOwnerPage } from "@/lib/page-auth";
import ShippingClient from "./shipping-client";
import FulfillmentClient from "./fulfillment-client";
export const dynamic = "force-dynamic";
export default async function ShippingPage() {
  await requireOwnerPage();
  return <main className="p-8"><h1 className="text-3xl font-bold mb-3">Shipping configuration</h1>
    <p className="mb-6">Manual fulfillment · Approved Tariff. No courier API is connected.</p><ShippingClient /><FulfillmentClient /></main>;
}
