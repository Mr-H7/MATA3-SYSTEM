"use client";
import { useCallback, useEffect, useState } from "react";
type Market = "EGYPT" | "MOROCCO";
type Destination = { id: string; publicKey: string; name: string; kind: string; parentId: string | null; active: boolean; tariffGroupCode: string | null; providerCityId: string | null; providerZoneId: string | null; providerDistrictId: string | null };
type Method = { id: string; code: string; label: string; active: boolean };
type Tariff = { id: string; methodId: string; destinationId: string | null; destinationGroupCode: string | null; amountMinor: number; active: boolean; effectiveFrom: string; effectiveTo: string | null };
type Row = { market: Market; currency: string; provider: string; enabled: boolean; ready: boolean; destinations: Destination[]; methods: Method[]; tariffs: Tariff[] };
export default function ShippingClient() {
  const [rows, setRows] = useState<Row[]>([]), [market, setMarket] = useState<Market>("EGYPT");
  const [status, setStatus] = useState("Loading…"), [busy, setBusy] = useState(false);
  const [destination, setDestination] = useState({ kind: "REGION", name: "", parentKey: "", tariffGroupCode: "", providerCityId: "", providerZoneId: "", providerDistrictId: "" });
  const [method, setMethod] = useState({ code: "", label: "" });
  const [tariff, setTariff] = useState({ methodCode: "", destinationKey: "", destinationGroupCode: "", amountMinor: "", effectiveFrom: "", effectiveTo: "" });
  const refresh = useCallback(async () => {
    try { const response = await fetch("/api/shipping", { cache: "no-store" });
      if (!response.ok) throw Error(); const result = await response.json() as { markets: Row[] };
      setRows(result.markets); setStatus("");
    } catch { setStatus("Shipping configuration could not be loaded."); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void fetch("/api/shipping", { cache: "no-store", signal: controller.signal })
    .then(r => { if (!r.ok) throw Error(); return r.json() as Promise<{ markets: Row[] }>; })
    .then(value => { if (!controller.signal.aborted) { setRows(value.markets); setStatus(""); } })
    .catch(() => { if (!controller.signal.aborted) setStatus("Shipping configuration could not be loaded."); });
    return () => controller.abort(); }, []);
  const active = rows.find(row => row.market === market);
  async function send(verb: "POST" | "PATCH", body: Record<string, unknown>) {
    setBusy(true); setStatus("");
    try {
      const response = await fetch("/api/shipping", { method: verb, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ market, ...body }) });
      const result = await response.json() as { code?: string };
      if (!response.ok) { setStatus(result.code || "Could not save shipping configuration."); return false; }
      await refresh(); return true;
    } catch { setStatus("Could not save shipping configuration."); return false; }
    finally { setBusy(false); }
  }
  const box = "bg-white border rounded p-4 mb-4";
  const input = "border rounded p-2 w-full";
  return <div>
    <div className={box}><label>Market<select className={input} value={market} onChange={e => setMarket(e.target.value as Market)}><option>EGYPT</option><option>MOROCCO</option></select></label>
      {active && <p className="mt-3"><b>{active.market} / {active.provider}</b> · {active.currency} · Manual / Approved Tariff · <strong>{active.ready ? "READY" : "NOT CONFIGURED"}</strong>
        <button className="btn btn-gold ml-4" disabled={busy} onClick={() => void send("POST", { type: "market", enabled: !active.enabled })}>{active.enabled ? "Disable market shipping" : "Enable market shipping"}</button></p>}</div>
    {status && <p role="alert" className="mb-4">{status}</p>}
    {!active ? null : <>
      <section className={box}><h2 className="text-xl font-bold mb-3">Destinations and internal mappings</h2>
        <form className="grid gap-2 md:grid-cols-3" onSubmit={e => { e.preventDefault(); void send("POST", { type: "destination", ...destination }).then(ok => { if (ok) setDestination({ kind: "REGION", name: "", parentKey: "", tariffGroupCode: "", providerCityId: "", providerZoneId: "", providerDistrictId: "" }); }); }}>
          <select className={input} value={destination.kind} onChange={e => setDestination({ ...destination, kind: e.target.value, parentKey: "" })}><option>REGION</option><option>CITY</option><option>DISTRICT</option></select>
          <input className={input} required placeholder="Customer-facing name" value={destination.name} onChange={e => setDestination({ ...destination, name: e.target.value })} />
          <select className={input} value={destination.parentKey} onChange={e => setDestination({ ...destination, parentKey: e.target.value })}><option value="">Parent (none for region)</option>{active.destinations.filter(d => destination.kind === "CITY" ? d.kind === "REGION" : destination.kind === "DISTRICT" ? d.kind === "CITY" : false).map(d => <option key={d.id} value={d.publicKey}>{d.name}</option>)}</select>
          <input className={input} placeholder="Tariff group code (optional)" value={destination.tariffGroupCode} onChange={e => setDestination({ ...destination, tariffGroupCode: e.target.value.toUpperCase() })} />
          <input className={input} placeholder="Provider city ID (internal)" value={destination.providerCityId} onChange={e => setDestination({ ...destination, providerCityId: e.target.value })} />
          <input className={input} placeholder="Provider zone ID (internal)" value={destination.providerZoneId} onChange={e => setDestination({ ...destination, providerZoneId: e.target.value })} />
          <input className={input} placeholder="Provider district ID (internal)" value={destination.providerDistrictId} onChange={e => setDestination({ ...destination, providerDistrictId: e.target.value })} />
          <button className="btn btn-gold" disabled={busy}>Add inactive destination</button>
        </form>
        <div className="mt-4">{active.destinations.map(d => <div className="border-t py-2 flex justify-between gap-3" key={d.id}><span>{d.kind} · {d.name} {d.tariffGroupCode ? "· " + d.tariffGroupCode : ""} · {d.active ? "Active" : "Inactive"}</span>
          <div><button className="btn" disabled={busy} onClick={() => void send("PATCH", { type: "destination", id: d.id, active: !d.active })}>{d.active ? "Deactivate" : "Activate"}</button>
          <details><summary>Edit destination / mapping</summary><form className="grid gap-2" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void send("PATCH", { type: "destination", id: d.id, changes: {
            name: data.get("name"), tariffGroupCode: data.get("tariffGroupCode"), providerCityId: data.get("providerCityId"),
            providerZoneId: data.get("providerZoneId"), providerDistrictId: data.get("providerDistrictId") } }); }}>
            <input className={input} name="name" required defaultValue={d.name} aria-label="Destination name" />
            <input className={input} name="tariffGroupCode" defaultValue={d.tariffGroupCode ?? ""} placeholder="Tariff group code" />
            <input className={input} name="providerCityId" defaultValue={d.providerCityId ?? ""} placeholder="Provider city ID" />
            <input className={input} name="providerZoneId" defaultValue={d.providerZoneId ?? ""} placeholder="Provider zone ID" />
            <input className={input} name="providerDistrictId" defaultValue={d.providerDistrictId ?? ""} placeholder="Provider district ID" />
            <button className="btn btn-gold" disabled={busy}>Save mapping</button></form></details></div></div>)}</div>
      </section>
      <section className={box}><h2 className="text-xl font-bold mb-3">Delivery methods</h2>
        <form className="grid gap-2 md:grid-cols-3" onSubmit={e => { e.preventDefault(); void send("POST", { type: "method", ...method }).then(ok => { if (ok) setMethod({ code: "", label: "" }); }); }}>
          <input className={input} required placeholder="Code e.g. STANDARD" value={method.code} onChange={e => setMethod({ ...method, code: e.target.value.toUpperCase() })} />
          <input className={input} required placeholder="Customer-facing label" value={method.label} onChange={e => setMethod({ ...method, label: e.target.value })} />
          <button className="btn btn-gold" disabled={busy}>Add inactive method</button>
        </form>
        {active.methods.map(m => <div className="border-t py-2 mt-2 flex justify-between gap-3" key={m.id}><span>{m.code} · {m.label} · {m.active ? "Active" : "Inactive"}</span>
          <div><button className="btn" disabled={busy} onClick={() => void send("PATCH", { type: "method", id: m.id, active: !m.active })}>{m.active ? "Deactivate" : "Activate"}</button>
          <details><summary>Edit public label</summary><form onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void send("PATCH", { type: "method", id: m.id, changes: { label: data.get("label") } }); }}>
            <input className={input} name="label" required defaultValue={m.label} aria-label="Method label" /><button className="btn btn-gold" disabled={busy}>Save label</button></form></details></div></div>)}
      </section>
      <section className={box}><h2 className="text-xl font-bold mb-3">Approved tariffs</h2><p>Rates are entered in minor units ({active.currency}). New tariffs start inactive and require explicit activation. Use a destination or a tariff group.</p>
        <form className="grid gap-2 md:grid-cols-3 mt-3" onSubmit={e => { e.preventDefault(); void send("POST", { type: "tariff", ...tariff, amountMinor: Number(tariff.amountMinor), effectiveFrom: new Date(tariff.effectiveFrom).toISOString(), ...(tariff.effectiveTo ? { effectiveTo: new Date(tariff.effectiveTo).toISOString() } : {}) }).then(ok => { if (ok) setTariff({ methodCode: "", destinationKey: "", destinationGroupCode: "", amountMinor: "", effectiveFrom: "", effectiveTo: "" }); }); }}>
          <select className={input} required value={tariff.methodCode} onChange={e => setTariff({ ...tariff, methodCode: e.target.value })}><option value="">Delivery method</option>{active.methods.map(m => <option key={m.id} value={m.code}>{m.label}</option>)}</select>
          <select className={input} value={tariff.destinationKey} onChange={e => setTariff({ ...tariff, destinationKey: e.target.value, destinationGroupCode: "" })}><option value="">Destination (or use group)</option>{active.destinations.map(d => <option key={d.id} value={d.publicKey}>{d.kind} · {d.name}</option>)}</select>
          <input className={input} placeholder="Destination group (instead)" value={tariff.destinationGroupCode} onChange={e => setTariff({ ...tariff, destinationGroupCode: e.target.value.toUpperCase(), destinationKey: "" })} />
          <input className={input} required type="number" min="1" step="1" placeholder="Amount in minor units" value={tariff.amountMinor} onChange={e => setTariff({ ...tariff, amountMinor: e.target.value })} />
          <label>Effective from<input className={input} required type="datetime-local" value={tariff.effectiveFrom} onChange={e => setTariff({ ...tariff, effectiveFrom: e.target.value })} /></label>
          <label>Effective to (optional)<input className={input} type="datetime-local" value={tariff.effectiveTo} onChange={e => setTariff({ ...tariff, effectiveTo: e.target.value })} /></label>
          <button className="btn btn-gold" disabled={busy}>Add inactive tariff</button>
        </form>
        {active.tariffs.map(t => <div className="border-t py-2 mt-2 flex justify-between gap-3" key={t.id}><span>{active.methods.find(m => m.id === t.methodId)?.code} · {active.destinations.find(d => d.id === t.destinationId)?.name ?? t.destinationGroupCode} · {t.amountMinor} {active.currency} minor units · {t.active ? "Active" : "Inactive"} · {new Date(t.effectiveFrom).toLocaleString()}</span>
          <button className="btn" disabled={busy} onClick={() => void send("PATCH", { type: "tariff", id: t.id, active: !t.active })}>{t.active ? "Deactivate" : "Activate"}</button></div>)}
      </section>
    </>}
  </div>;
}
