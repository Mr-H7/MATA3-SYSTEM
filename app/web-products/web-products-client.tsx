"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Row = {
  id: string;
  price: string;
  available: boolean;
  inventoryType: string;
  webPublicationStatus: "DRAFT" | "PUBLISHED" | "HIDDEN";
  updatedAt: string;
  availableStock: number;
  market: { code: string; currency: string };
  product: {
    id: string;
    sku: string;
    nameEn: string;
    publicSlug: string | null;
    images: Array<{ url: string }>;
    category: { name: string } | null;
  };
  variant: { sku: string; size: string | null; color: string | null } | null;
  inventory: { currentStock: number; reservedStock: number } | null;
};

export default function WebProductsClient({ initialRows }: { initialRows: Row[] }) {
  const router = useRouter();
  const [market, setMarket] = useState<"ALL" | "EGYPT" | "MOROCCO">("ALL");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const rows = useMemo(
    () =>
      initialRows.filter((row) => {
        if (market !== "ALL" && row.market.code !== market) return false;
        if (!query.trim()) return true;
        const needle = query.toLowerCase();
        return `${row.product.nameEn} ${row.product.sku} ${row.variant?.sku ?? ""} ${row.product.category?.name ?? ""}`.toLowerCase().includes(needle);
      }),
    [initialRows, market, query],
  );

  async function setStatus(listingId: string, webPublicationStatus: Row["webPublicationStatus"]) {
    setBusyId(listingId);
    setError("");
    const response = await fetch("/api/web-products", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ listingId, webPublicationStatus }) });
    setBusyId("");
    if (!response.ok) return setError((await response.json()).error || "Update failed");
    router.refresh();
  }

  return (
    <main>
      <header className="page-header">
        <div>
          <div className="eyebrow">Catalogue / Web Products · منتجات الموقع</div>
          <h1 className="page-title mt-2">Web Products</h1>
          <p className="page-subtitle">Market-aware publication for the future MATA3 ecommerce website.</p>
        </div>
      </header>
      <section className="toolbar">
        <span aria-hidden="true">⌕</span>
        <input className="min-w-56 flex-1 border-0 bg-transparent p-1 shadow-none focus:shadow-none" placeholder="Search product, SKU, category…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select className="form-control !w-auto" value={market} onChange={(event) => setMarket(event.target.value as typeof market)}>
          <option value="ALL">All markets</option>
          <option value="EGYPT">Egypt</option>
          <option value="MOROCCO">Morocco</option>
        </select>
      </section>
      {error ? <p className="mt-3 rounded bg-[#fdf0ed] p-3 text-[#c0392b]">{error}</p> : null}
      <section className="data-table-wrap mt-4">
        <table className="data-table">
          <thead>
            <tr>
              {["Image", "Product", "Category", "Market", "Price", "Variant", "Web Status", "Last Updated", "Actions"].map((heading) => (
                <th key={heading}>{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const image = row.product.images[0];
              return (
                <tr key={row.id}>
                  <td>{image ? <Image unoptimized src={image.url} alt="" width={40} height={40} className="h-10 w-10 rounded object-cover" /> : "—"}</td>
                  <td>
                    <strong>{row.product.nameEn}</strong>
                    <div className="text-xs text-[#6e685e]">{row.product.sku}</div>
                  </td>
                  <td>{row.product.category?.name ?? "—"}</td>
                  <td>
                    <span className="badge">{row.market.code}</span>
                  </td>
                  <td>
                    {Number(row.price).toFixed(2)} {row.market.currency}
                  </td>
                  <td>{[row.variant?.color, row.variant?.size].filter(Boolean).join(" / ") || "—"} · {row.inventoryType === "PHYSICAL_STOCK" ? `stock ${row.availableStock}` : row.inventoryType.replaceAll("_", " ").toLowerCase()}</td>
                  <td>
                    <span className="badge">{row.webPublicationStatus}</span>
                  </td>
                  <td>{new Date(row.updatedAt).toLocaleDateString()}</td>
                  <td className="whitespace-nowrap">
                    <Link className="btn btn-secondary !min-h-8 !px-2 !text-xs" href={`/catalogue/${row.product.id}/edit`}>
                      Edit product
                    </Link>
                    {row.webPublicationStatus !== "PUBLISHED" ? (
                      <button className="btn btn-gold ml-1 !min-h-8 !px-2 !text-xs" disabled={busyId === row.id} onClick={() => setStatus(row.id, "PUBLISHED")}>
                        Publish
                      </button>
                    ) : (
                      <button className="btn btn-secondary ml-1 !min-h-8 !px-2 !text-xs" disabled={busyId === row.id} onClick={() => setStatus(row.id, "HIDDEN")}>
                        Hide
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length ? <div className="empty-state">No listings match these filters.</div> : null}
      </section>
      <p className="mt-4 text-xs text-[#6e685e]">
        Public read API: <code>/api/public/products?market=EGYPT</code> and <code>/api/public/products/[slug]?market=EGYPT</code>
      </p>
    </main>
  );
}
