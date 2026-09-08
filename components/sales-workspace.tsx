"use client";

import { MagnifyingGlass, Receipt } from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useDemoStore } from "@/lib/demo-store";
import { formatAED, formatDateTime } from "@/lib/domain";

export function SalesWorkspace() {
  const { sales, creditNotes } = useDemoStore();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return sales.filter((sale) => !term || sale.invoiceNumber.toLowerCase().includes(term) || sale.paymentMethod.includes(term) || sale.customer?.name.toLowerCase().includes(term));
  }, [query, sales]);
  const gross = sales.reduce((sum, sale) => sum + sale.grossFils, 0);
  const vat = sales.reduce((sum, sale) => sum + sale.vatFils, 0);

  return (
    <>
      <div className="page-heading"><div><div className="eyebrow">Immutable invoice ledger</div><h1 className="page-title">Sales</h1><p className="page-copy">Completed invoices are preserved exactly as issued and can be printed again at any time.</p></div><Link className="button primary" href="/sale">New sale</Link></div>
      <section className="metric-grid sales-metrics"><div className="metric"><div className="metric-label">Invoices</div><div className="metric-value">{sales.length}</div><div className="metric-note">Completed documents</div></div><div className="metric"><div className="metric-label">Gross value</div><div className="metric-value">{formatAED(gross)}</div><div className="metric-note">Before returns</div></div><div className="metric"><div className="metric-label">VAT included</div><div className="metric-value">{formatAED(vat)}</div><div className="metric-note">Standard rate 5%</div></div><div className="metric"><div className="metric-label">Credit notes</div><div className="metric-value">{creditNotes.length}</div><div className="metric-note">{formatAED(creditNotes.reduce((sum, note) => sum + note.grossFils, 0))} refunded</div></div></section>
      <section className="panel sales-ledger"><div className="panel-body"><div className="search"><MagnifyingGlass size={16} weight="bold" /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search invoice, customer, or payment" aria-label="Search sales" /></div></div>{filtered.length ? <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Issued</th><th>Payment</th><th>Items</th><th className="numeric">VAT</th><th className="numeric">Total</th></tr></thead><tbody>{filtered.map((sale) => <tr key={sale.id}><td><Link className="invoice-link" href={`/sales/${sale.id}`}>{sale.invoiceNumber}</Link>{creditNotes.some((note) => note.saleId === sale.id) && <div className="product-meta">Credit issued</div>}</td><td>{sale.customer?.name ?? "Walk-in"}</td><td>{formatDateTime(sale.createdAt)}</td><td><span className={`badge ${sale.paymentMethod === "cash" ? "green" : "blue"}`}>{sale.paymentMethod}</span></td><td>{sale.lines.reduce((sum, line) => sum + line.quantity, 0)}</td><td className="numeric">{formatAED(sale.vatFils)}</td><td className="numeric product-name">{formatAED(sale.grossFils)}</td></tr>)}</tbody></table></div> : <div className="empty"><Receipt size={30} weight="duotone" /><h3>No matching invoices</h3><p>Change the search or complete a new sale.</p></div>}</section>
    </>
  );
}
