"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
type Row = { id: string; url: string; altText: string; sortOrder: number; isCover: boolean; publicationStatus: string; type: string };
type Data = { media: Row[]; products: { id: string; nameEn: string }[]; variants: { id: string; productId: string; color: string | null; size: string | null }[]; bundles: { id: string; name: string; listings: { id: string; webPublicationStatus: string; market: { code: string } }[] }[] };
export default function WebMediaPage() {
  const [data, setData] = useState<Data | null>(null), [message, setMessage] = useState("");
  const [targetType, setTargetType] = useState("productId"), [targetId, setTargetId] = useState("");
  const load = async () => { const r = await fetch("/api/web-media", { cache: "no-store" }); if (r.ok) setData(await r.json()); else setMessage("Unable to load media."); };
  useEffect(() => { const controller = new AbortController(); void fetch("/api/web-media", { cache: "no-store", signal: controller.signal }).then(async response => { if (response.ok && !controller.signal.aborted) setData(await response.json()); }).catch(() => {}); return () => controller.abort(); }, []);
  const send = async (path: string, method: string, body: BodyInit) => {
    const r = await fetch(path, { method, body, ...(typeof body === "string" ? { headers: { "Content-Type": "application/json" } } : {}) });
    setMessage(r.ok ? "Saved." : "Action failed."); if (r.ok) await load();
  };
  const targets = targetType === "productId" ? data?.products.map(p => ({ id: p.id, label: p.nameEn })) : targetType === "variantId" ? data?.variants.map(v => ({ id: v.id, label: [data.products.find(p => p.id === v.productId)?.nameEn, v.color, v.size].filter(Boolean).join(" / ") })) : data?.bundles.map(b => ({ id: b.id, label: b.name }));
  return <main style={{ padding: 24, maxWidth: 1000, margin: "auto" }}><h1>Storefront media</h1><p>Owner only. Internal ProductImage is separate. Uploads start as draft.</p><p role="status">{message}</p>
    <form onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); form.set(targetType, targetId); void send("/api/web-media", "POST", form); }}>
      <label>Target type <select value={targetType} onChange={e => { setTargetType(e.target.value); setTargetId(""); }}><option value="productId">Product</option><option value="variantId">Variant</option><option value="bundleId">Bundle</option></select></label>
      <label>Target <select required value={targetId} onChange={e => setTargetId(e.target.value)}><option value="">Select target</option>{targets?.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
      <label>File <input name="file" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" required /></label>
      <label>Alt text <input name="altText" maxLength={300} /></label><button>Upload draft</button>
    </form><h2>Media</h2>{data?.media.map(row => <article key={row.id} style={{ border: "1px solid #aaa", padding: 12, marginBlock: 12 }}>
      {row.type === "IMAGE" ? <Image src={row.url} alt={row.altText} width={150} height={150} unoptimized style={{ maxWidth: 150, height: "auto" }} /> : <video src={row.url} controls style={{ maxWidth: 200 }} />}
      <p>{row.type} · {row.publicationStatus} · {row.isCover ? "Cover" : "Supporting"}</p>
      <label>Alt <input defaultValue={row.altText} onBlur={e => { if (e.target.value !== row.altText) void send("/api/web-media/" + row.id, "PATCH", JSON.stringify({ altText: e.target.value })); }} /></label>
      <label>Order <input type="number" min={0} max={10000} defaultValue={row.sortOrder} onBlur={e => { const value = Number(e.target.value); if (value !== row.sortOrder) void send("/api/web-media/" + row.id, "PATCH", JSON.stringify({ sortOrder: value })); }} /></label>
      <button onClick={() => void send("/api/web-media/" + row.id, "PATCH", JSON.stringify({ isCover: !row.isCover }))}>{row.isCover ? "Unset cover" : "Set cover"}</button>
      <select aria-label="Publication" value={row.publicationStatus} onChange={e => void send("/api/web-media/" + row.id, "PATCH", JSON.stringify({ publicationStatus: e.target.value }))}><option>DRAFT</option><option>PUBLISHED</option><option>HIDDEN</option></select>
      <button onClick={() => { if (window.confirm("Remove web media?")) void send("/api/web-media/" + row.id, "DELETE", ""); }}>Remove</button>
    </article>)}<h2>Bundles</h2>{data?.bundles.map(bundle => <article key={bundle.id}><h3>{bundle.name}</h3>{bundle.listings.map(listing => <label key={listing.id}>{listing.market.code} <select value={listing.webPublicationStatus} onChange={e => void send("/api/web-bundles", "PATCH", JSON.stringify({ listingId: listing.id, webPublicationStatus: e.target.value }))}><option>DRAFT</option><option>PUBLISHED</option><option>HIDDEN</option></select></label>)}</article>)}
  </main>;
}
