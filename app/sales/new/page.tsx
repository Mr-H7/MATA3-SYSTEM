"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type MarketCode = "EGYPT" | "MOROCCO";
type ProductRow = {
  id: string; price: string | number; availableStock?: number;
  market: { code: MarketCode; currency: string };
  product: { nameEn: string; nameAr: string; sku: string; brand?: string | null; model?: string | null; category?: { name: string } | null };
  variant?: { sku: string; color?: string | null; size?: string | null } | null;
  inventory?: { currentStock: number; reservedStock: number } | null;
};
type BundleRow = { id: string; name: string; status: string; listings: { price: string | number; market: { code: MarketCode; currency: string } }[] };
type CartItem = { key: string; listingId?: string; bundleId?: string; name: string; detail: string; price: number; quantity: number };
type SessionPayload = { role: string; marketScope: "ALL" | MarketCode };

const marketLabel = (code: MarketCode) => code === "EGYPT" ? "Egypt" : "Morocco";

export default function NewSale() {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [market, setMarket] = useState<MarketCode | "">("");
  const [allowedMarkets, setAllowedMarkets] = useState<MarketCode[]>([]);
  const [seller, setSeller] = useState(false);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [bundles, setBundles] = useState<BundleRow[]>([]);
  const [items, setItems] = useState<CartItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discount, setDiscount] = useState(0);
  const [shipping, setShipping] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [paymentStatus, setPaymentStatus] = useState("PENDING");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.json()).then((user: SessionPayload) => {
      const allowed: MarketCode[] = user.marketScope === "ALL" ? ["EGYPT", "MOROCCO"] : [user.marketScope];
      setAllowedMarkets(allowed); setMarket(allowed[0]); setSeller(user.role === "SELLER");
    });
  }, []);

  useEffect(() => {
    if (!market) return;
    Promise.all([
      fetch(`/api/catalogue?market=${market}`, { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/bundles", { cache: "no-store" }).then((response) => response.json()),
    ]).then(([catalogue, bundleRows]: [unknown, unknown]) => {
      setProducts(Array.isArray(catalogue) ? catalogue as ProductRow[] : []);
      setBundles(Array.isArray(bundleRows) ? (bundleRows as BundleRow[]).filter((bundle) => bundle.status !== "ARCHIVED" && bundle.listings.some((listing) => listing.market.code === market)) : []);
    }).catch(() => setError("Unable to load sellable items.")).finally(() => setLoading(false));
  }, [market]);

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key === "F2") { event.preventDefault(); setItems([]); }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, []);

  const currency = market === "EGYPT" ? "EGP" : "MAD";
  const filteredProducts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return products;
    return products.filter((row) => `${row.product.nameEn} ${row.product.nameAr} ${row.product.sku} ${row.product.brand ?? ""} ${row.product.model ?? ""} ${row.variant?.sku ?? ""} ${row.variant?.color ?? ""} ${row.variant?.size ?? ""}`.toLowerCase().includes(needle));
  }, [products, query]);
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = Math.max(0, subtotal - discount + shipping);
  const stock = (row: ProductRow) => row.availableStock ?? Math.max(0, (row.inventory?.currentStock ?? 0) - (row.inventory?.reservedStock ?? 0));

  function addItem(item: Omit<CartItem, "quantity">) {
    setItems((current) => {
      const existing = current.find((candidate) => candidate.key === item.key);
      return existing ? current.map((candidate) => candidate.key === item.key ? { ...candidate, quantity: candidate.quantity + 1 } : candidate) : [...current, { ...item, quantity: 1 }];
    });
  }
  const addProduct = (row: ProductRow) => addItem({ key: `listing-${row.id}`, listingId: row.id, name: row.product.nameEn, detail: row.variant ? [row.variant.sku, row.variant.color, row.variant.size].filter(Boolean).join(" · ") : row.product.sku, price: Number(row.price) });
  const addBundle = (bundle: BundleRow) => { const listing = bundle.listings.find((candidate) => candidate.market.code === market); if (listing) addItem({ key: `bundle-${bundle.id}`, bundleId: bundle.id, name: bundle.name, detail: "Virtual bundle · component stock", price: Number(listing.price) }); };
  const setQuantity = (key: string, quantity: number) => setItems((current) => quantity < 1 ? current.filter((item) => item.key !== key) : current.map((item) => item.key === key ? { ...item, quantity } : item));
  function changeMarket(code: MarketCode) { setLoading(true); setError(""); setItems([]); setMarket(code); }

  async function save() {
    if (!market || !items.length || saving) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/sales", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ marketCode: market, items: items.map(({ listingId, bundleId, quantity }) => ({ listingId, bundleId, quantity })), customerName, customerPhone, discount, shipping, paymentMethod, paymentStatus, notes }) });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok) { setError(result.error || "Sale failed"); return; }
      router.push(result.id ? `/sales/${result.id}` : "/sales"); router.refresh();
    } catch { setError("Unable to complete the sale. Please try again."); }
    finally { setSaving(false); }
  }

  return <main className="!p-0">
    <div className="pos-layout">
      <section className="pos-catalogue">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e5ded3] bg-white px-6 py-4">
          <div><div className="eyebrow">Commerce / New Sale</div><h1 className="page-title mt-1">New Sale <span className="ml-2 text-base font-normal text-[#8c7356]">عملية بيع جديدة</span></h1></div>
          <label className="flex items-center gap-2 text-xs font-semibold">Market<select className="form-control !w-auto min-w-36" value={market} onChange={(event) => changeMarket(event.target.value as MarketCode)}>{allowedMarkets.map((code) => <option key={code} value={code}>{marketLabel(code)} · {code === "EGYPT" ? "EGP" : "MAD"}</option>)}</select></label>
        </div>
        <div className="p-5 lg:p-6">
          <div className="toolbar"><span aria-hidden="true">⌕</span><input ref={searchRef} className="min-w-0 flex-1 border-0 bg-transparent p-1 text-base shadow-none focus:shadow-none" placeholder="Search product, SKU, brand, model or variant… (Press '/' to focus)" value={query} onChange={(event) => setQuery(event.target.value)} />{query ? <button className="btn btn-secondary !min-h-8 !px-2" onClick={() => setQuery("")}>Clear</button> : null}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2"><span className="badge bg-[#11100e] text-white">{filteredProducts.length} sellable products</span>{bundles.length ? <span className="badge badge-warning">{bundles.length} bundles</span> : null}<span className="ml-auto text-xs text-[#6e685e]">{market ? `${marketLabel(market)} · ${currency}` : "Loading market…"}</span></div>
          {loading ? <div className="empty-state">Loading catalogue…</div> : <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {filteredProducts.map((row) => { const available = stock(row); return <article className={`product-tile${available <= 0 ? " opacity-60" : ""}`} key={row.id}><div className="flex items-start justify-between gap-3"><div><div className="font-mono text-[10px] text-[#6e685e]">{row.variant?.sku || row.product.sku}</div><h2 className="mt-2 text-base font-bold">{row.product.nameEn}</h2><p className="text-xs text-[#6e685e]">{[row.product.brand, row.product.model].filter(Boolean).join(" · ") || row.product.nameAr}</p></div><span className={available <= 0 ? "badge badge-danger" : available <= 3 ? "badge badge-warning" : "badge badge-success"}>{available <= 0 ? "Out of stock" : `${available} in stock`}</span></div>{row.variant ? <div className="mt-4"><div className="eyebrow">Variant</div><span className="badge mt-1">{[row.variant.color, row.variant.size].filter(Boolean).join(" / ") || row.variant.sku}</span></div> : <div className="h-12" />}<div className="mt-4 flex items-end justify-between border-t border-[#e5ded3] pt-3"><div><div className="text-xs text-[#6e685e]">Selling price</div><strong className="text-lg">{Number(row.price).toFixed(2)} <span className="text-xs text-[#8c7356]">{row.market.currency}</span></strong></div><button className="btn btn-primary" disabled={available <= 0} onClick={() => addProduct(row)}>＋ Add</button></div></article>; })}
            {bundles.map((bundle) => { const listing = bundle.listings.find((candidate) => candidate.market.code === market); return <article className="product-tile border-[#c6a227]" key={bundle.id}><div className="flex justify-between gap-3"><div><span className="badge badge-warning">BUNDLE</span><h2 className="mt-2 text-base font-bold">{bundle.name}</h2><p className="text-xs text-[#6e685e]">Availability is derived from components</p></div></div><div className="mt-8 flex items-end justify-between border-t border-[#e5ded3] pt-3"><strong className="text-lg">{Number(listing?.price ?? 0).toFixed(2)} <span className="text-xs text-[#8c7356]">{currency}</span></strong><button className="btn btn-primary" onClick={() => addBundle(bundle)}>＋ Add</button></div></article>; })}
            {!filteredProducts.length && !bundles.length ? <div className="empty-state col-span-full">No sellable items match this search.</div> : null}
          </div>}
        </div>
      </section>
      <aside className="pos-cart">
        <div className="flex items-center justify-between border-b border-[#e5ded3] px-5 py-4"><div><h2 className="section-title">Current Sale <span className="font-normal text-[#8c7356]">· سلة البيع</span></h2><p className="page-subtitle">{items.reduce((sum, item) => sum + item.quantity, 0)} items</p></div>{items.length ? <button className="btn btn-secondary !min-h-8" onClick={() => setItems([])}>Clear</button> : null}</div>
        <div className="pos-cart-items">{items.length ? items.map((item) => <div className="cart-line" key={item.key}><div className="min-w-0 flex-1"><strong className="block truncate">{item.name}</strong><div className="truncate text-xs text-[#6e685e]">{item.detail} · {item.price.toFixed(2)} {currency}</div></div><div className="quantity-control"><button onClick={() => setQuantity(item.key, item.quantity - 1)}>−</button><span>{item.quantity}</span><button onClick={() => setQuantity(item.key, item.quantity + 1)}>＋</button></div><strong className="w-24 text-right">{(item.price * item.quantity).toFixed(2)}</strong></div>) : <div className="empty-state"><div className="mb-2 text-2xl">▤</div>Your sale is empty.<br />Choose an exact product or bundle.</div>}</div>
        <div className="pos-checkout">
          <div className="grid grid-cols-2 gap-2"><input className="form-control" placeholder="Customer name (optional)" value={customerName} onChange={(event) => setCustomerName(event.target.value)} /><input className="form-control" placeholder="Phone (optional)" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} /></div>
          <div className="mt-4"><div className="eyebrow mb-2">Payment method</div><div className="grid grid-cols-2 gap-2">{["Cash", "InstaPay", "Vodafone Cash", "Card", "Bank Transfer", "Cash on Delivery"].map((method) => <button className={`payment-option${paymentMethod === method ? " selected" : ""}`} key={method} onClick={() => setPaymentMethod(method)}>{method}</button>)}</div></div>
          <div className="mt-3 grid grid-cols-2 gap-2"><label className="text-xs text-[#6e685e]">Payment status<select className="form-control mt-1" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)}><option>PENDING</option><option>PAID</option><option>PARTIAL</option></select></label><label className="text-xs text-[#6e685e]">Shipping<input className="form-control mt-1" type="number" min="0" value={shipping} onChange={(event) => setShipping(Number(event.target.value))} /></label></div>
          {!seller ? <label className="mt-3 block text-xs text-[#6e685e]">Discount<input className="form-control mt-1" type="number" min="0" max={subtotal} value={discount} onChange={(event) => setDiscount(Number(event.target.value))} /></label> : null}
          <label className="mt-3 block text-xs text-[#6e685e]">Notes<textarea className="form-control mt-1 min-h-16 resize-y" value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          <div className="mt-4 space-y-2 border-t border-[#e5ded3] pt-4 text-sm"><div className="flex justify-between"><span className="text-[#6e685e]">Subtotal</span><span>{subtotal.toFixed(2)} {currency}</span></div>{discount > 0 ? <div className="flex justify-between"><span className="text-[#6e685e]">Discount</span><span>−{discount.toFixed(2)} {currency}</span></div> : null}{shipping > 0 ? <div className="flex justify-between"><span className="text-[#6e685e]">Shipping</span><span>{shipping.toFixed(2)} {currency}</span></div> : null}<div className="flex items-end justify-between border-t-2 border-[#11100e] pt-3"><strong>Total due</strong><strong className="text-2xl">{total.toFixed(2)} <span className="text-xs text-[#8c7356]">{currency}</span></strong></div></div>
          {error ? <p className="mt-3 rounded bg-[#fdf0ed] p-3 text-sm text-[#c0392b]" role="alert">{error}</p> : null}
          <button className="btn btn-gold mt-4 w-full !min-h-12 text-base" disabled={saving || !items.length} onClick={save}>{saving ? "Completing sale…" : "✓ Confirm Sale · تأكيد البيع"}</button>
          <div className="mt-2 text-center text-[10px] text-[#6e685e]">Price, stock, seller identity and totals are validated by the server.</div>
        </div>
      </aside>
    </div>
  </main>;
}
