"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ImportMode, ImportPreview } from "@/lib/catalogue-import";

type ApplyResult = {
  runId: string;
  createdProducts: number;
  updatedProducts: number;
  createdListings: number;
  updatedListings: number;
  createdSuppliers: number;
  skippedIncomplete: number;
};

export default function BulkImportClient() {
  const [mode, setMode] = useState<ImportMode>("CREATE");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const formData = useMemo(() => {
    const data = new FormData();
    data.set("mode", mode);
    if (file) data.set("file", file);
    return data;
  }, [file, mode]);

  async function runPreview() {
    if (!file) return setError("Select a .csv or .xlsx file first.");
    setBusy("preview");
    setError("");
    setResult(null);
    const response = await fetch("/api/catalogue/import/preview", { method: "POST", body: formData });
    const payload = await response.json();
    setBusy("");
    if (!response.ok) return setError(payload.error || "Preview failed");
    setPreview(payload.preview);
    setToken(payload.confirmToken);
  }

  async function confirm() {
    if (!file || !token) return;
    setBusy("confirm");
    setError("");
    const data = new FormData();
    data.set("mode", mode);
    data.set("file", file);
    data.set("confirmToken", token);
    const response = await fetch("/api/catalogue/import/confirm", { method: "POST", body: data });
    const payload = await response.json();
    setBusy("");
    if (!response.ok) return setError(payload.error || "Import failed");
    setPreview(payload.preview);
    setResult(payload.result);
    setToken(null);
  }

  async function downloadErrors() {
    if (!file) return;
    const response = await fetch("/api/catalogue/import/errors", { method: "POST", body: formData });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "Report failed" }));
      return setError(payload.error || "Report failed");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mata3-import-issues.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main>
      <header className="page-header">
        <div>
          <div className="eyebrow">Catalogue / Bulk Import</div>
          <h1 className="page-title mt-2">Bulk Import</h1>
          <p className="page-subtitle">Parse and preview a supplier spreadsheet before any catalogue write.</p>
        </div>
        <Link href="/catalogue" className="btn btn-secondary">← Products</Link>
      </header>

      <section className="card p-5 mt-4 space-y-4">
        <div className="eyebrow">Step 1 — Download Template</div>
        <a className="btn btn-gold" href="/api/catalogue/import/template">Download .xlsx template</a>
      </section>

      <section className="card p-5 mt-4 space-y-4">
        <div className="eyebrow">Step 2 — Select CREATE or MERGE</div>
        <div className="flex gap-3">
          {(["CREATE", "MERGE"] as const).map((option) => (
            <label key={option} className="flex items-center gap-2 rounded border border-[#e5ded3] px-3 py-2 text-sm">
              <input type="radio" name="mode" checked={mode === option} onChange={() => { setMode(option); setPreview(null); setToken(null); setResult(null); }} />
              {option}
            </label>
          ))}
        </div>
        <p className="page-subtitle">{mode === "CREATE" ? "New SKUs only. Existing SKUs block the import." : "Match by exact SKU. Blank cells do not erase existing values."}</p>
      </section>

      <section className="card p-5 mt-4 space-y-4">
        <div className="eyebrow">Step 3 — Upload CSV/XLSX</div>
        <input type="file" accept=".csv,.xlsx" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setToken(null); setResult(null); }} />
      </section>

      <section className="card p-5 mt-4 space-y-4">
        <div className="eyebrow">Step 4 — Validation</div>
        <button className="btn btn-gold" disabled={!file || Boolean(busy)} onClick={runPreview}>{busy === "preview" ? "Parsing…" : "Parse and dry-run"}</button>
        {error ? <p className="rounded bg-[#fdf0ed] p-3 text-[#c0392b]" role="alert">{error}</p> : null}
      </section>

      {preview ? (
        <>
          <section className="card p-5 mt-4 space-y-3">
            <div className="eyebrow">Step 5 — Review Changes</div>
            <p className="text-sm">{preview.sourceRows} source rows · {preview.summary.newProducts} new products · {preview.summary.existingProductsUpdated} existing products updated · {preview.summary.awaitingSupplierCost} awaiting supplier cost · {preview.summary.variantWarnings} variant warnings · {preview.summary.provenanceWarnings} HIGH_COPY warnings · {preview.summary.blockingSkuCollisions} blocking SKU collisions · {preview.summary.errors} errors</p>
            <div className="flex gap-2">
              <button className="btn btn-secondary" onClick={downloadErrors}>Download issue report</button>
            </div>
            {preview.issues.length ? (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead><tr>{["Row", "SKU", "Market", "Level", "Code", "Message"].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead>
                  <tbody>
                    {preview.issues.map((issue, index) => (
                      <tr key={`${issue.rowNumber}-${issue.code}-${index}`}>
                        <td>{issue.rowNumber}</td>
                        <td className="font-mono">{issue.sku}</td>
                        <td>{issue.market}</td>
                        <td><span className={`badge ${issue.level === "ERROR" ? "badge-danger" : "badge-warning"}`}>{issue.level}</span></td>
                        <td>{issue.code}</td>
                        <td>{issue.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="page-subtitle">No validation issues.</p>}
            <div className="data-table-wrap">
              <table className="data-table">
                <thead><tr>{["SKU", "Action", "Market", "Listing", "Changes"].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead>
                <tbody>
                  {preview.products.flatMap((product) => product.listings.map((listing) => (
                    <tr key={`${product.productSku}-${listing.marketCode}-${listing.variantSku}`}>
                      <td className="font-mono">{product.productSku}</td>
                      <td>{product.action}</td>
                      <td>{listing.marketCode}</td>
                      <td>{listing.incomplete ? "incomplete" : listing.action}</td>
                      <td className="text-xs">
                        {[...product.diffs, ...listing.diffs].filter((item) => item.status !== "unchanged").slice(0, 8).map((item) => (
                          <div key={item.field}>{item.field}: {item.from} → {item.to}</div>
                        )) || "No field changes"}
                      </td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card p-5 mt-4 space-y-3">
            <div className="eyebrow">Step 6 — Confirm Import</div>
            <button className="btn btn-gold" disabled={!preview.canConfirm || !token || Boolean(busy)} onClick={confirm}>
              {busy === "confirm" ? "Importing…" : "Confirm atomic import"}
            </button>
            {!preview.canConfirm ? <p className="page-subtitle">Confirm stays disabled until errors are cleared and the dry-run contains writes.</p> : null}
          </section>
        </>
      ) : null}

      {result ? (
        <section className="card p-5 mt-4 space-y-2">
          <div className="eyebrow">Step 7 — Results</div>
          <p>Import run {result.runId}</p>
          <p>{result.createdProducts} products created · {result.updatedProducts} products updated · {result.createdListings} listings created · {result.updatedListings} listings updated · {result.createdSuppliers} suppliers created · {result.skippedIncomplete} incomplete rows skipped</p>
        </section>
      ) : null}
    </main>
  );
}
