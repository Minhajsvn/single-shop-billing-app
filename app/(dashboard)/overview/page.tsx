"use client";

import { CheckCircle, Receipt, WarningCircle } from "@/components/icons";
import Link from "next/link";
import { EmptyState } from "@/components/ui/list-parts";
import { getRegisterTotals, useDemoStore, useShopContext } from "@/lib/demo-store";
import { formatAED, formatTime } from "@/lib/domain";

export default function OverviewPage() {
  const store = useDemoStore();
  const { mode } = useShopContext();
  const lowStock = store.products.filter((product) => product.active && product.stock <= product.lowStockThreshold);
  const totals = getRegisterTotals(store);
  const grossFils = store.sales.reduce((sum, sale) => sum + sale.grossFils, 0) - store.creditNotes.reduce((sum, note) => sum + note.grossFils, 0);
  const vatFils = store.sales.reduce((sum, sale) => sum + sale.vatFils, 0) - store.creditNotes.reduce((sum, note) => sum + note.vatFils, 0);
  const registerOpen = store.register?.status === "open";
  const today = new Intl.DateTimeFormat("en-AE", { timeZone: "Asia/Dubai", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{today}</div>
          <h1 className="page-title">Good afternoon.</h1>
          <p className="page-copy">A clear view of today’s sales, drawer position, and items that need attention.</p>
        </div>
        <span className={`badge ${registerOpen ? "green" : "red"}`}>{registerOpen ? "Register open" : "Register closed"}</span>
      </div>

      {mode !== "hosted" ? <div className="notice"><WarningCircle size={18} weight="fill" /><div><strong>{mode === "sample" ? "Sample shop." : "Local demo mode."}</strong> {mode === "sample" ? "This is demo data and nothing is saved to an account." : "Product and stock changes are saved in this browser. Connect Supabase credentials to enable hosted accounts and synchronized records."}</div></div> : null}

      <section className="metric-grid" aria-label="Today's sales summary">
        <div className="metric"><div className="metric-label">Gross sales</div><div className="metric-value">{formatAED(grossFils)}</div><div className="metric-note">{store.sales.length} invoices in demo ledger</div></div>
        <div className="metric"><div className="metric-label">Cash</div><div className="metric-value">{formatAED(totals.cashSalesFils - totals.cashReturnsFils)}</div><div className="metric-note">Expected drawer {formatAED(totals.expectedCashFils)}</div></div>
        <div className="metric"><div className="metric-label">Card</div><div className="metric-value">{formatAED(totals.cardSalesFils - totals.cardReturnsFils)}</div><div className="metric-note">Net of returns</div></div>
        <div className="metric"><div className="metric-label">VAT included</div><div className="metric-value">{formatAED(vatFils)}</div><div className="metric-note">Standard rate 5%</div></div>
      </section>

      <div className="grid-two">
        <section className="panel">
          <div className="panel-header"><div><div className="panel-title">Recent invoices</div><div className="panel-subtitle">Latest completed sales</div></div><Link href="/sales" className="button">View all</Link></div>
          {store.sales.length ? <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Time</th><th>Payment</th><th className="numeric">Total</th></tr></thead><tbody>{store.sales.slice(0, 5).map((sale) => <tr key={sale.id}><td><Link className="invoice-link" href={`/sales/${sale.id}`}>{sale.invoiceNumber}</Link></td><td>{formatTime(sale.createdAt)}</td><td><span className={`badge ${sale.paymentMethod === "cash" ? "green" : "blue"}`}>{sale.paymentMethod}</span></td><td className="numeric">{formatAED(sale.grossFils)}</td></tr>)}</tbody></table></div> : <EmptyState compact icon={<Receipt size={28} weight="duotone" />} title="No sales yet" hint="Completed sales appear here." action={<Link className="button primary" href="/sale">New sale</Link>} />}
        </section>

        <section className="panel">
          <div className="panel-header"><div><div className="panel-title">Low stock</div><div className="panel-subtitle">At or below reorder level</div></div><span className="badge red">{lowStock.length} items</span></div>
          {lowStock.length ? <div className="panel-body"><div className="low-stock-list">{lowStock.map((product) => <div className="low-stock-item" key={product.id}><div><div className="product-name">{product.name}</div><div className="product-meta">{product.sku} · threshold {product.lowStockThreshold}</div></div><div className="stock-number">{product.stock} left</div></div>)}</div></div> : <EmptyState compact icon={<CheckCircle size={28} weight="duotone" />} title="Stock levels are fine" hint="Products at or below their reorder level appear here." />}
        </section>
      </div>
    </>
  );
}
