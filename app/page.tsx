import Link from "next/link";
import { redirect } from "next/navigation";
import { isSeller, getSessionUser } from "@/lib/auth";
import { businessDayBounds } from "@/lib/business-time";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const money = (value: number, currency: string) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)} ${currency}`;
const marketName = (code: string) => code === "EGYPT" ? "Egypt" : "Morocco";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const seller = isSeller(user);
  const marketWhere = user.marketScope === "ALL" ? {} : { code: user.marketScope };
  const markets = await prisma.market.findMany({ where: marketWhere, orderBy: { code: "asc" } });
  const bounds = markets.map((market) => ({ market, ...businessDayBounds(market.timezone) }));
  const todayFilter = bounds.map(({ market, start, end }) => ({ marketId: market.id, createdAt: { gte: start, lt: end } }));
  const saleScope = { ...(seller ? { createdById: user.id } : {}), status: { not: "CANCELLED" as const } };
  const [todaySales, recentSales, listings, inventories, lowStock, pendingReturns, activeTarget] = await Promise.all([
    prisma.sale.findMany({ where: { ...saleScope, OR: todayFilter }, include: { items: true, market: true } }),
    prisma.sale.findMany({ where: { ...saleScope, market: marketWhere }, include: { market: true }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.marketListing.count({ where: { market: marketWhere, available: true, product: { status: "ACTIVE" } } }),
    seller ? Promise.resolve([]) : prisma.inventory.findMany({ where: { market: marketWhere }, include: { market: true, listing: { select: { cost: true } } } }),
    prisma.inventory.findMany({ where: { market: marketWhere, listing: { product: { status: "ACTIVE" }, inventoryType: "PHYSICAL_STOCK" } }, include: { market: true, listing: { include: { product: { select: { nameEn: true, sku: true } }, variant: { select: { sku: true } } } } }, orderBy: { currentStock: "asc" } }),
    seller ? Promise.resolve(0) : prisma.return.count({ where: { market: marketWhere, refundStatus: "PENDING" } }),
    seller ? prisma.target.findFirst({ where: { userId: user.id, active: true, market: marketWhere, endDate: { gte: new Date() } }, include: { market: true }, orderBy: { endDate: "asc" } }) : Promise.resolve(null),
  ]);
  const perMarket = markets.map((market) => {
    const sales = todaySales.filter((sale) => sale.marketId === market.id);
    const revenue = sales.reduce((sum, sale) => sum + Number(sale.total), 0);
    const profit = sales.reduce((sum, sale) => sum + sale.items.reduce((lineSum, item) => lineSum + (Number(item.unitPrice) - Number(item.unitCost ?? 0)) * item.quantity, 0), 0);
    const stockValue = inventories.filter((inventory) => inventory.marketId === market.id).reduce((sum, inventory) => sum + Number(inventory.listing.cost) * inventory.currentStock, 0);
    return { market, sales, revenue, profit, stockValue };
  });
  const sellerRevenue = perMarket.reduce((sum, row) => sum + row.revenue, 0);
  const sellerOrders = perMarket.reduce((sum, row) => sum + row.sales.length, 0);
  const targetProgress = activeTarget ? (activeTarget.type === "REVENUE" ? sellerRevenue : sellerOrders) : 0;
  const targetPercent = activeTarget && Number(activeTarget.amount) > 0 ? Math.min(100, (targetProgress / Number(activeTarget.amount)) * 100) : 0;
  const stockAlerts = lowStock.filter((row) => row.currentStock - row.reservedStock <= row.listing.minimumStock);
  const outOfStock = stockAlerts.filter((row) => row.currentStock - row.reservedStock <= 0).length;
  const lowOnly = stockAlerts.filter((row) => row.currentStock - row.reservedStock > 0).length;

  if (seller) {
    const market = markets[0];
    return <main>
      <section className="card card-pad mb-6 flex flex-wrap items-center justify-between gap-4">
        <div><div className="eyebrow">{market ? `${marketName(market.code)} · ${market.currency}` : "Assigned market"}</div><h1 className="page-title mt-2">Welcome, {user.name}</h1><p className="page-subtitle">Your sales activity and current operational priorities.</p></div>
        <Link className="btn btn-gold" href="/sales/new">＋ New Sale</Link>
      </section>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="metric-card"><div className="metric-label">Today&apos;s Revenue</div><div className="metric-value">{money(sellerRevenue, market?.currency ?? "")}</div><div className="metric-note">From your completed activity today</div></div>
        <div className="metric-card"><div className="metric-label">Today&apos;s Sales</div><div className="metric-value">{sellerOrders}</div><div className="metric-note">Orders attributed to your account</div></div>
        <div className="metric-card"><div className="metric-label">My Target</div><div className="metric-value">{activeTarget ? money(Number(activeTarget.amount), activeTarget.market.currency) : "Not set"}</div><div className="metric-note">{activeTarget?.type === "SALES_COUNT" ? "Sales-count target" : "Revenue target"}</div></div>
        <div className="metric-card"><div className="metric-label">Target Progress</div><div className="metric-value">{targetPercent.toFixed(1)}%</div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[#efece6]"><div className="h-full bg-[#c6a227]" style={{ width: `${targetPercent}%` }} /></div></div>
      </section>
      <section className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="card overflow-hidden"><div className="flex items-center justify-between border-b border-[#e5ded3] p-4"><div><h2 className="section-title">Recent Sales</h2><p className="page-subtitle">Your latest transactions</p></div><Link className="btn btn-secondary" href="/sales">View all</Link></div>{recentSales.length ? <div className="divide-y divide-[#eee8df]">{recentSales.map((sale) => <Link className="flex items-center justify-between gap-3 p-4 hover:bg-[#fbf8f5]" href={`/sales/${sale.id}`} key={sale.id}><div><strong>{sale.invoiceNumber}</strong><div className="text-xs text-[#6e685e]">{sale.customerName || "Walk-in customer"} · {sale.createdAt.toLocaleString()}</div></div><strong>{money(Number(sale.total), sale.market.currency)}</strong></Link>)}</div> : <div className="empty-state">No sales recorded yet.</div>}</div>
        <div className="card card-pad"><div className="flex items-center justify-between"><h2 className="section-title">Stock Availability</h2><span className="badge">{market?.code}</span></div><div className="mt-4 space-y-2">{stockAlerts.length ? stockAlerts.slice(0, 6).map((row) => { const available = row.currentStock - row.reservedStock; return <div className="rounded-md bg-[#fbf8f5] p-3" key={row.id}><div className="flex justify-between gap-3"><strong>{row.listing.product.nameEn}</strong><span className={available <= 0 ? "badge badge-danger" : "badge badge-warning"}>{available <= 0 ? "Out of stock" : `${available} left`}</span></div><div className="mt-1 font-mono text-xs text-[#6e685e]">{row.listing.variant?.sku || row.listing.product.sku}</div></div>; }) : <p className="text-sm text-[#6e685e]">No stock alerts.</p>}</div><Link className="btn btn-primary mt-4 w-full" href="/catalogue">Browse products</Link></div>
      </section>
    </main>;
  }

  return <main>
    <section className="page-header">
      <div><div className="eyebrow">Executive overview</div><h1 className="page-title mt-2">Business Overview</h1><p className="page-subtitle">Sales, inventory and activity across authorized markets.</p></div>
      <div className="flex flex-wrap gap-2"><Link className="btn btn-secondary" href="/catalogue/new">＋ Add Product</Link><Link className="btn btn-secondary" href="/inventory">Adjust Inventory</Link><Link className="btn btn-primary" href="/reports">View Reports →</Link></div>
    </section>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className="metric-card border-t-4 border-t-[#c6a227]"><div className="metric-label">Today&apos;s Revenue</div>{perMarket.map(({ market, revenue }) => <div className="mt-3 flex items-end justify-between" key={market.id}><span className="text-sm text-[#6e685e]">{marketName(market.code)}</span><strong className="text-lg">{money(revenue, market.currency)}</strong></div>)}</div>
      <div className="metric-card"><div className="metric-label">Completed Orders</div><div className="metric-value">{todaySales.length}</div><div className="metric-note">{perMarket.map(({ market, sales }) => `${marketName(market.code)}: ${sales.length}`).join(" · ") || "No markets"}</div></div>
      <div className="metric-card"><div className="metric-label">Gross Profit <span className="role-badge ml-1">OWNER</span></div>{perMarket.map(({ market, profit }) => <div className="mt-3 flex items-end justify-between" key={market.id}><span className="text-sm text-[#6e685e]">{marketName(market.code)}</span><strong className="text-lg">{money(profit, market.currency)}</strong></div>)}</div>
      <div className="metric-card"><div className="metric-label">Inventory Value <span className="role-badge ml-1">OWNER</span></div>{perMarket.map(({ market, stockValue }) => <div className="mt-3 flex items-end justify-between" key={market.id}><span className="text-sm text-[#6e685e]">{marketName(market.code)}</span><strong className="text-lg">{money(stockValue, market.currency)}</strong></div>)}</div>
    </section>
    <section className="card card-pad mt-6"><div className="eyebrow">Needs Attention</div><div className="mt-4 grid gap-3 md:grid-cols-3"><Link href="/inventory" className="rounded-md border border-[#f6dfc2] bg-[#fdf3e7] p-4"><strong>{lowOnly} Low Stock</strong><div className="mt-1 text-xs text-[#6e685e]">Items at or below minimum stock</div></Link><Link href="/inventory" className="rounded-md border border-[#f7ccc5] bg-[#fdf0ed] p-4"><strong>{outOfStock} Out of Stock</strong><div className="mt-1 text-xs text-[#6e685e]">Physical items with no available units</div></Link><Link href="/returns" className="rounded-md border border-[#e5ded3] bg-[#fbf8f5] p-4"><strong>{pendingReturns} Pending Returns</strong><div className="mt-1 text-xs text-[#6e685e]">Awaiting refund resolution</div></Link></div></section>
    <section className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
      <div className="card overflow-hidden"><div className="flex items-center justify-between border-b border-[#e5ded3] p-4"><div><h2 className="section-title">Recent Sales</h2><p className="page-subtitle">Latest order activity across markets</p></div><Link className="btn btn-secondary" href="/sales">View all</Link></div>{recentSales.length ? <div className="data-table-wrap border-0"><table className="data-table"><thead><tr><th>Invoice</th><th>Customer</th><th>Market</th><th>Status</th><th className="text-right">Total</th></tr></thead><tbody>{recentSales.map((sale) => <tr key={sale.id}><td><Link className="font-semibold underline" href={`/sales/${sale.id}`}>{sale.invoiceNumber}</Link></td><td>{sale.customerName || "Walk-in"}</td><td><span className="badge">{marketName(sale.market.code)}</span></td><td>{sale.status}</td><td className="text-right font-semibold">{money(Number(sale.total), sale.market.currency)}</td></tr>)}</tbody></table></div> : <div className="empty-state">No sales recorded yet.</div>}</div>
      <div className="card card-pad"><h2 className="section-title">Market Performance</h2><p className="page-subtitle">Today&apos;s independent ledgers</p><div className="mt-4 space-y-3">{perMarket.map(({ market, revenue, sales }) => <div className="rounded-md border border-[#e5ded3] p-4" key={market.id}><div className="flex justify-between"><strong>{marketName(market.code)}</strong><span className="badge">{market.currency}</span></div><div className="mt-3 flex justify-between text-sm"><span className="text-[#6e685e]">Revenue</span><strong>{money(revenue, market.currency)}</strong></div><div className="mt-2 flex justify-between text-sm"><span className="text-[#6e685e]">Orders</span><strong>{sales.length}</strong></div></div>)}</div><div className="mt-4 text-xs text-[#6e685e]">{listings} active market listings</div></div>
    </section>
  </main>;
}
