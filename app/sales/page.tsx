import Link from "next/link";
import { isSeller, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Sales() {
  const user = await requireUser();
  const rows = await prisma.sale.findMany({ where: { ...(user.marketScope !== "ALL" ? { market: { code: user.marketScope } } : {}), ...(isSeller(user) ? { createdById: user.id } : {}) }, include: { market: true }, orderBy: { createdAt: "desc" } });
  return <main>
    <header className="page-header"><div><div className="eyebrow">Commerce / Sales</div><h1 className="page-title mt-2">Sales & Invoices</h1><p className="page-subtitle">Historical transactions within your authorized scope.</p></div><Link className="btn btn-gold" href="/sales/new">＋ New Sale</Link></header>
    <section className="data-table-wrap"><table className="data-table"><thead><tr>{["Invoice", "Date", "Market", "Customer", "Total", "Payment", "Payment Status", "Sale Status"].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.map((sale) => <tr key={sale.id}><td><Link className="font-semibold underline" href={`/sales/${sale.id}`}>{sale.invoiceNumber}</Link></td><td>{sale.createdAt.toLocaleString()}</td><td><span className="badge">{sale.market.code}</span></td><td>{sale.customerName || "Walk-in"}</td><td className="font-semibold">{sale.total.toString()} <small>{sale.market.currency}</small></td><td>{sale.paymentMethod || "—"}</td><td><span className={sale.paymentStatus === "PAID" ? "badge badge-success" : "badge badge-warning"}>{sale.paymentStatus}</span></td><td><span className={sale.status === "CANCELLED" ? "badge badge-danger" : "badge"}>{sale.status}</span></td></tr>)}</tbody></table>{!rows.length ? <div className="empty-state">No sales found.</div> : null}</section>
  </main>;
}
