import Link from "next/link";
import { requireOwnerPage } from "@/lib/page-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Reports({ searchParams }: { searchParams: Promise<{ market?: string }> }) {
  await requireOwnerPage();
  const { market = "ALL" } = await searchParams;
  const markets = await prisma.market.findMany({ where: market !== "ALL" ? { code: market } : {}, orderBy: { code: "asc" } });
  const ledgers = await Promise.all(markets.map(async (marketRow) => {
    const [sales, returns] = await Promise.all([
      prisma.sale.findMany({ where: { marketId: marketRow.id, status: { not: "CANCELLED" } }, include: { items: true, createdBy: { select: { name: true } } } }),
      prisma.return.aggregate({ where: { marketId: marketRow.id }, _sum: { refundAmount: true } }),
    ]);
    const revenue = sales.reduce((sum, sale) => sum + Number(sale.total), 0);
    const profit = sales.reduce((sum, sale) => sum + sale.items.reduce((lineSum, item) => lineSum + (Number(item.unitPrice) - Number(item.unitCost ?? 0)) * item.quantity, 0), 0);
    const refunded = Number(returns._sum.refundAmount ?? 0);
    const payments = [...new Set(sales.map((sale) => sale.paymentMethod || "Unknown"))].map((method) => ({ method, amount: sales.filter((sale) => (sale.paymentMethod || "Unknown") === method).reduce((sum, sale) => sum + Number(sale.total), 0) }));
    return { market: marketRow, sales, revenue, profit, refunded, payments };
  }));
  return <main>
    <header className="page-header"><div><div className="eyebrow">Intelligence / Reports</div><h1 className="page-title mt-2">Commerce Reports</h1><p className="page-subtitle">Owner-only financial performance from historical sale snapshots.</p></div><Link className="btn btn-secondary" href="/export">Export data</Link></header>
    <form className="toolbar"><label className="text-xs font-semibold text-[#6e685e]">Market<select name="market" defaultValue={market} className="form-control ml-2 !w-auto"><option value="ALL">All Markets · separate ledgers</option><option value="EGYPT">Egypt · EGP</option><option value="MOROCCO">Morocco · MAD</option></select></label><button className="btn btn-primary">Apply Filter</button></form>
    <div className="mt-5 space-y-5">{ledgers.map((ledger) => <section className="card card-pad" key={ledger.market.id}><div className="flex items-center justify-between"><div><h2 className="section-title">{ledger.market.name}</h2><p className="page-subtitle">Independent {ledger.market.currency} ledger</p></div><span className="badge">{ledger.market.code} · {ledger.market.currency}</span></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[["Revenue", ledger.revenue], ["Gross Profit", ledger.profit], ["Orders", ledger.sales.length], ["Returns", ledger.refunded], ["Average Order", ledger.sales.length ? ledger.revenue / ledger.sales.length : 0]].map(([label, value]) => <div className="rounded-md bg-[#fbf8f5] p-4" key={String(label)}><div className="metric-label">{label}</div><div className="mt-2 text-xl font-bold">{label === "Orders" ? value : `${Number(value).toFixed(2)} ${ledger.market.currency}`}</div></div>)}</div><div className="mt-5 border-t border-[#e5ded3] pt-4"><div className="eyebrow">Payment methods</div><div className="mt-2 flex flex-wrap gap-2">{ledger.payments.length ? ledger.payments.map((payment) => <span className="badge" key={payment.method}>{payment.method}: {payment.amount.toFixed(2)} {ledger.market.currency}</span>) : <span className="text-sm text-[#6e685e]">No sales data.</span>}</div></div></section>)}</div>
  </main>;
}
