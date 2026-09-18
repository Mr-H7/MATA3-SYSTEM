"use client";
import { useCallback, useEffect, useState } from "react";
type Row = { reference: string; market: string; status: string; paymentStatus: string; fulfillmentStatus: string; customerName: string; placedAt: string };
export default function FulfillmentClient() {
  const [orders, setOrders] = useState<Row[]>([]), [message, setMessage] = useState("Loading orders…"), [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    try { const response = await fetch("/api/storefront-orders?page=1", { cache: "no-store" }); if (!response.ok) throw Error();
      const result = await response.json() as { items: Row[] }; setOrders(result.items); setMessage(result.items.length ? "" : "No storefront orders yet.");
    } catch { setMessage("Orders could not be loaded."); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void fetch("/api/storefront-orders?page=1", { cache: "no-store", signal: controller.signal })
    .then(r => { if (!r.ok) throw Error(); return r.json() as Promise<{ items: Row[] }>; })
    .then(result => { if (!controller.signal.aborted) { setOrders(result.items); setMessage(result.items.length ? "" : "No storefront orders yet."); } })
    .catch(() => { if (!controller.signal.aborted) setMessage("Orders could not be loaded."); });
    return () => controller.abort(); }, []);
  async function update(reference: string, status: string) {
    setBusy(reference); setMessage("");
    try {
      const response = await fetch("/api/storefront-orders/" + encodeURIComponent(reference) + "/fulfillment", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      if (!response.ok) { setMessage("Fulfillment state could not be updated."); return; }
      await load();
    } catch { setMessage("Fulfillment state could not be updated."); }
    finally { setBusy(""); }
  }
  const choices = (row: Row) => row.status === "CANCELLED" ? [] :
    row.fulfillmentStatus === "READY_FOR_FULFILLMENT" ? ["MANUAL_FULFILLMENT", "FULFILLMENT_EXCEPTION"] :
    row.fulfillmentStatus === "MANUAL_FULFILLMENT" ? ["FULFILLED", "FULFILLMENT_EXCEPTION"] :
    row.fulfillmentStatus === "FULFILLMENT_EXCEPTION" ? ["MANUAL_FULFILLMENT"] : [];
  return <section className="bg-white border rounded p-4 mt-6"><h2 className="text-xl font-bold mb-2">Manual fulfillment queue</h2>
    <p className="mb-3">These are internal fulfillment states. Updating them does not create a courier shipment or change payment status.</p>
    {message && <p role="status">{message}</p>}
    {orders.map(row => <div key={row.reference} className="border-t py-3 flex flex-wrap items-center justify-between gap-3">
      <span><b>{row.reference}</b> · {row.market} · {row.customerName}<br />Order: {row.status} · Payment: {row.paymentStatus} · Fulfillment: {row.fulfillmentStatus}</span>
      <span className="flex gap-2">{choices(row).map(status => <button className="btn" key={status} disabled={!!busy}
        onClick={() => void update(row.reference, status)}>{status.replaceAll("_", " ")}</button>)}</span>
    </div>)}
  </section>;
}
