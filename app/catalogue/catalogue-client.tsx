"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type CatalogueRow = {
  id: string; productId: string; cost?: string; price: string; availableStock?: number;
  market: { code: string; currency: string };
  product: { sku: string; nameEn: string; nameAr: string; status: string; brand?: string | null; model?: string | null; category?: { name: string } | null };
  variant?: { sku: string; color?: string | null; size?: string | null } | null;
  inventory?: { currentStock: number; reservedStock: number } | null;
};

export default function CatalogueClient({ initialRows, seller = false }: { initialRows: CatalogueRow[]; seller?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [market, setMarket] = useState("ALL");
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState("");
  const rows = useMemo(() => initialRows.filter((row) => (market === "ALL" || row.market.code === market) && (showArchived ? row.product.status === "ARCHIVED" : row.product.status !== "ARCHIVED") && (!query || `${row.product.nameEn} ${row.product.nameAr} ${row.product.sku} ${row.variant?.sku || ""} ${row.product.brand || ""} ${row.product.model || ""}`.toLowerCase().includes(query.toLowerCase()))), [initialRows, query, market, showArchived]);
  async function archive(id: string) {
    if (!confirm("Archive this product? It will remain in historical sales.")) return;
    const response = await fetch(`/api/products/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "ARCHIVED" }) });
    if (response.ok) { setError(""); router.refresh(); } else setError((await response.json()).error || "Product could not be archived.");
  }
  return <main>
    <header className="page-header"><div><div className="eyebrow">Catalogue / Products</div><h1 className="page-title mt-2">{seller ? "Products" : "Master Catalogue"}</h1><p className="page-subtitle">{seller ? "Sellable products in your assigned market." : "Products, variants and independent market listings."}</p></div>{!seller ? <Link href="/catalogue/new" className="btn btn-gold">＋ Add Product</Link> : null}</header>
    <section className="toolbar"><span aria-hidden="true">⌕</span><input className="min-w-56 flex-1 border-0 bg-transparent p-1 shadow-none focus:shadow-none" placeholder="Search name, SKU, brand, model or variant…" value={query} onChange={(event) => setQuery(event.target.value)} />{!seller ? <><select className="form-control !w-auto" value={market} onChange={(event) => setMarket(event.target.value)}><option value="ALL">All Markets</option><option value="EGYPT">Egypt · EGP</option><option value="MOROCCO">Morocco · MAD</option></select><label className="flex items-center gap-2 rounded border border-[#e5ded3] px-3 py-2 text-xs"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Archived only</label></> : null}</section>
    {error ? <p className="mt-3 rounded bg-[#fdf0ed] p-3 text-[#c0392b]" role="alert">{error}</p> : null}
    <section className="data-table-wrap mt-4"><table className="data-table"><thead><tr>{["SKU", "Product", "Variant", "Market", ...(seller ? [] : ["Cost"]), "Price", "Available", "Status", ...(seller ? [] : ["Actions"])].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.map((row) => { const stock = row.availableStock ?? (row.inventory?.currentStock ?? 0) - (row.inventory?.reservedStock ?? 0); return <tr key={row.id}><td className="font-mono">{row.variant?.sku || row.product.sku}</td><td><strong>{row.product.nameEn}</strong><div className="text-xs text-[#6e685e]" dir="auto">{row.product.nameAr}</div></td><td>{[row.variant?.color, row.variant?.size].filter(Boolean).join(" / ") || "—"}</td><td><span className="badge">{row.market.code}</span></td>{!seller ? <td>{Number(row.cost).toFixed(2)} <small>{row.market.currency}</small></td> : null}<td className="font-semibold">{Number(row.price).toFixed(2)} <small>{row.market.currency}</small></td><td><span className={stock <= 0 ? "badge badge-danger" : stock <= 3 ? "badge badge-warning" : "badge badge-success"}>{stock}</span></td><td><span className={`badge ${row.product.status === "ACTIVE" ? "badge-success" : row.product.status === "ARCHIVED" ? "" : "badge-warning"}`}>{row.product.status.replaceAll("_", " ")}</span></td>{!seller ? <td className="whitespace-nowrap"><Link className="btn btn-secondary !min-h-8 !px-2 !text-xs" href={`/catalogue/${row.productId}`}>View</Link><Link className="btn btn-secondary ml-1 !min-h-8 !px-2 !text-xs" href={`/catalogue/${row.productId}/edit`}>Edit</Link>{row.product.status !== "ARCHIVED" ? <button className="btn btn-danger ml-1 !min-h-8 !px-2 !text-xs" onClick={() => archive(row.productId)}>Archive</button> : null}</td> : null}</tr>; })}</tbody></table>{!rows.length ? <div className="empty-state">No catalogue rows match these filters.</div> : null}</section>
  </main>;
}
