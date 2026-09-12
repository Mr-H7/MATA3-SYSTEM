"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

type AdjustmentMode = "ADD" | "SUBTRACT" | "SET";
type AdjustmentReason = "PURCHASE" | "RETURN" | "CORRECTION" | "DAMAGE" | "TRANSFER" | "OTHER";
type InventoryRow = {
  id: string; currentStock: number; reservedStock: number; market: { code: string; currency: string };
  listing: { cost: string; price: string; minimumStock: number; inventoryType: string; product: { sku: string; nameEn: string; brand?: string | null }; variant?: { sku: string; color?: string | null; size?: string | null } | null; supplier?: { name: string } | null };
};
type MovementRow = { id: string; quantityChange: number; previousQuantity: number; newQuantity: number; reason: string; reference?: string | null; createdAt: string; user?: { name: string } | null; inventory: { market: { code: string }; listing: { product: { nameEn: string; sku: string }; variant?: { sku: string } | null } } };

const REASONS: AdjustmentReason[] = ["PURCHASE", "RETURN", "CORRECTION", "DAMAGE", "TRANSFER", "OTHER"];
const available = (row: InventoryRow) => row.currentStock - row.reservedStock;

export default function InventoryClient({ rows, movements }: { rows: InventoryRow[]; movements: MovementRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [market, setMarket] = useState("ALL");
  const [stockFilter, setStockFilter] = useState("ALL");
  const [adjustment, setAdjustment] = useState<{ row: InventoryRow; mode: AdjustmentMode } | null>(null);
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<AdjustmentReason>("PURCHASE");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const filteredRows = useMemo(() => rows.filter((row) => {
    const matchesMarket = market === "ALL" || row.market.code === market;
    const needle = query.toLowerCase();
    const matchesSearch = !needle || `${row.listing.product.nameEn} ${row.listing.product.sku} ${row.listing.variant?.sku ?? ""} ${row.listing.product.brand ?? ""}`.toLowerCase().includes(needle);
    const level = available(row);
    const matchesStock = stockFilter === "ALL" || (stockFilter === "OUT" ? level <= 0 : stockFilter === "LOW" ? level > 0 && level <= row.listing.minimumStock : level > row.listing.minimumStock);
    return matchesMarket && matchesSearch && matchesStock;
  }), [rows, market, query, stockFilter]);
  const physical = rows.filter((row) => row.listing.inventoryType === "PHYSICAL_STOCK");
  const low = physical.filter((row) => available(row) > 0 && available(row) <= row.listing.minimumStock).length;
  const out = physical.filter((row) => available(row) <= 0).length;
  const values = ["EGYPT", "MOROCCO"].map((code) => ({ code, currency: code === "EGYPT" ? "EGP" : "MAD", value: rows.filter((row) => row.market.code === code).reduce((sum, row) => sum + Number(row.listing.cost) * row.currentStock, 0) }));

  function openAdjustment(row: InventoryRow, mode: AdjustmentMode) {
    setAdjustment({ row, mode }); setQuantity(""); setReason(mode === "SET" ? "CORRECTION" : "PURCHASE"); setReference(""); setError("");
  }
  function closeAdjustment() { if (!busy) { setAdjustment(null); setError(""); } }
  const projected = adjustment && quantity !== "" ? adjustment.mode === "SET" ? Number(quantity) : adjustment.row.currentStock + (adjustment.mode === "ADD" ? Number(quantity) : -Number(quantity)) : adjustment?.row.currentStock;

  async function applyAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!adjustment) return;
    const parsedQuantity = Number(quantity); const minimum = adjustment.mode === "SET" ? 0 : 1;
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < minimum) { setError(adjustment.mode === "SET" ? "Quantity must be a non-negative integer." : "Quantity must be a positive integer."); return; }
    if (adjustment.mode === "SUBTRACT" && parsedQuantity > adjustment.row.currentStock) { setError(`Cannot remove ${parsedQuantity} units. Only ${adjustment.row.currentStock} units are available.`); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/inventory/${adjustment.row.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: adjustment.mode, quantity: parsedQuantity, reason, reference }) });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) { setError(result?.error || "Inventory adjustment failed."); return; }
      setAdjustment(null); router.refresh();
    } catch { setError("Unable to update inventory. Please try again."); }
    finally { setBusy(false); }
  }

  return <main>
    <header className="page-header"><div><div className="eyebrow">Catalogue / Inventory</div><h1 className="page-title mt-2">Inventory <span className="text-base font-normal text-[#8c7356]">إدارة المخزون</span></h1><p className="page-subtitle">Monitor independent market stock and record authenticated adjustments.</p></div><button className="btn btn-gold" disabled={!filteredRows.length} onClick={() => filteredRows[0] && openAdjustment(filteredRows[0], "ADD")}>＋ Adjust Stock</button></header>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className="metric-card"><div className="metric-label">Inventory Records</div><div className="metric-value">{rows.length}</div><div className="metric-note">{physical.length} physical · {rows.length - physical.length} inventory-light</div></div>
      <div className="metric-card"><div className="metric-label">Low Stock</div><div className="metric-value text-[#c97a1e]">{low}</div><div className="metric-note">At or below configured minimum</div></div>
      <div className="metric-card"><div className="metric-label">Stockouts</div><div className="metric-value text-[#c0392b]">{out}</div><div className="metric-note">Physical listings with no available stock</div></div>
      <div className="metric-card bg-[#11100e] text-white"><div className="metric-label !text-[#c6a227]">Total Value · Owner</div>{values.map((item) => <div className="mt-3 flex justify-between" key={item.code}><span className="text-xs text-[#aaa49a]">{item.code}</span><strong>{item.value.toFixed(2)} <small className="text-[#c6a227]">{item.currency}</small></strong></div>)}</div>
    </section>
    <section className="toolbar mt-5"><span aria-hidden="true">⌕</span><input className="min-w-56 flex-1 border-0 bg-transparent p-1 shadow-none focus:shadow-none" placeholder="Search product, SKU, brand or variant…" value={query} onChange={(event) => setQuery(event.target.value)} /><select className="form-control !w-auto" value={market} onChange={(event) => setMarket(event.target.value)}><option value="ALL">All Markets</option><option value="EGYPT">Egypt · EGP</option><option value="MOROCCO">Morocco · MAD</option></select><select className="form-control !w-auto" value={stockFilter} onChange={(event) => setStockFilter(event.target.value)}><option value="ALL">All Stock</option><option value="IN">In Stock</option><option value="LOW">Low Stock</option><option value="OUT">Out of Stock</option></select></section>
    <section className="data-table-wrap mt-4"><table className="data-table"><thead><tr>{["Product", "SKU", "Variant", "Market", "Type", "Cost", "Price", "Stock", "Minimum", "Status", "Action"].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{filteredRows.map((row) => { const level = available(row); const status = level <= 0 ? "OUT" : level <= row.listing.minimumStock ? "LOW" : "IN"; return <tr key={row.id}><td><strong>{row.listing.product.nameEn}</strong><div className="text-[10px] text-[#6e685e]">{row.listing.product.brand || row.listing.supplier?.name || "—"}</div></td><td className="font-mono">{row.listing.variant?.sku || row.listing.product.sku}</td><td>{[row.listing.variant?.color, row.listing.variant?.size].filter(Boolean).join(" / ") || "—"}</td><td><span className="badge">{row.market.code}</span></td><td>{row.listing.inventoryType.replaceAll("_", " ")}</td><td>{Number(row.listing.cost).toFixed(2)} <small>{row.market.currency}</small></td><td>{Number(row.listing.price).toFixed(2)} <small>{row.market.currency}</small></td><td><strong className="text-base">{level}</strong><div className="text-[10px] text-[#6e685e]">{row.currentStock} current · {row.reservedStock} reserved</div></td><td>{row.listing.minimumStock}</td><td><span className={`badge ${status === "OUT" ? "badge-danger" : status === "LOW" ? "badge-warning" : "badge-success"}`}>{status === "OUT" ? "Out of stock" : status === "LOW" ? "Low stock" : "In stock"}</span></td><td><button className="btn btn-primary !min-h-8 !px-2 !text-xs" onClick={() => openAdjustment(row, "ADD")}>Adjust</button></td></tr>; })}</tbody></table>{!filteredRows.length ? <div className="empty-state">No inventory records match these filters.</div> : null}</section>
    <section className="card mt-5 overflow-hidden"><div className="border-b border-[#e5ded3] p-4"><h2 className="section-title">Authenticated Stock Movements</h2><p className="page-subtitle">Recent inventory changes recorded by the system</p></div>{movements.length ? <div className="divide-y divide-[#eee8df]">{movements.map((movement) => <div className="grid gap-2 p-3 text-xs md:grid-cols-[44px_minmax(180px,1fr)_110px_150px]" key={movement.id}><span className={`badge justify-center ${movement.quantityChange < 0 ? "badge-danger" : "badge-success"}`}>{movement.quantityChange > 0 ? "+" : ""}{movement.quantityChange}</span><div><strong>{movement.inventory.listing.product.nameEn}</strong><div className="text-[#6e685e]">{movement.inventory.listing.variant?.sku || movement.inventory.listing.product.sku} · {movement.reason}{movement.reference ? ` · ${movement.reference}` : ""}</div></div><div>{movement.previousQuantity} → <strong>{movement.newQuantity}</strong></div><div className="text-[#6e685e]">{new Date(movement.createdAt).toLocaleString()}<br />{movement.user?.name || "System"}</div></div>)}</div> : <div className="empty-state">No inventory movements recorded.</div>}</section>
    {adjustment ? <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="inventory-adjustment-title"><form className="card w-full max-w-lg overflow-hidden" onSubmit={applyAdjustment}><div className="border-b border-[#e5ded3] p-5"><div className="eyebrow">Inventory Adjustment · {adjustment.row.market.code}</div><h2 id="inventory-adjustment-title" className="section-title mt-1">{adjustment.row.listing.product.nameEn}</h2><p className="page-subtitle">{adjustment.row.listing.variant?.sku || adjustment.row.listing.product.sku}</p></div><div className="p-5"><div className="grid grid-cols-3 gap-2 rounded-md bg-[#fbf8f5] p-3 text-center"><div><div className="eyebrow">Current</div><strong className="text-xl">{adjustment.row.currentStock}</strong></div><div><div className="eyebrow">Change</div><strong className="text-xl">{adjustment.mode === "ADD" ? "+" : adjustment.mode === "SUBTRACT" ? "−" : "="}{quantity || "0"}</strong></div><div><div className="eyebrow">After</div><strong className={`text-xl ${(projected ?? 0) < 0 ? "text-[#c0392b]" : ""}`}>{Number.isFinite(projected) ? projected : adjustment.row.currentStock}</strong></div></div><div className="mt-4 grid grid-cols-3 gap-2">{(["ADD", "SUBTRACT", "SET"] as AdjustmentMode[]).map((mode) => <button type="button" className={`payment-option${adjustment.mode === mode ? " selected" : ""}`} key={mode} onClick={() => { setAdjustment({ row: adjustment.row, mode }); setReason(mode === "SET" ? "CORRECTION" : "PURCHASE"); setError(""); }}>{mode === "SUBTRACT" ? "REMOVE" : mode}</button>)}</div><label className="mt-4 block text-xs font-semibold text-[#6e685e]">Quantity<input autoFocus className="form-control mt-1" type="number" min={adjustment.mode === "SET" ? 0 : 1} step="1" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label className="mt-3 block text-xs font-semibold text-[#6e685e]">Reason<select className="form-control mt-1" value={reason} onChange={(event) => setReason(event.target.value as AdjustmentReason)}>{REASONS.map((option) => <option key={option}>{option}</option>)}</select></label><label className="mt-3 block text-xs font-semibold text-[#6e685e]">Reference / Note<input className="form-control mt-1" value={reference} onChange={(event) => setReference(event.target.value)} /></label>{error ? <p className="mt-3 rounded bg-[#fdf0ed] p-3 text-sm text-[#c0392b]" role="alert">{error}</p> : null}</div><div className="flex justify-end gap-2 border-t border-[#e5ded3] bg-[#fbf8f5] p-4"><button className="btn btn-secondary" type="button" disabled={busy} onClick={closeAdjustment}>Cancel</button><button className="btn btn-gold" type="submit" disabled={busy || (projected ?? 0) < 0}>{busy ? "Applying…" : "Apply Adjustment"}</button></div></form></div> : null}
  </main>;
}
