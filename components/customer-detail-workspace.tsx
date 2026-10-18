"use client";

import { ArrowLeft, IdentificationCard, Receipt } from "@phosphor-icons/react";
import Link from "next/link";
import { useDemoStore } from "@/lib/demo-store";
import { formatAED, formatDateTime } from "@/lib/domain";
import { EmptyState } from "@/components/ui/list-parts";

export function CustomerDetailWorkspace({ id }: { id: string }) {
  const store = useDemoStore();
  const customer = store.customers.find((item) => item.id === id);
  if (!customer) return <section className="panel"><div className="empty"><IdentificationCard size={32} weight="duotone" /><h3>Customer not found</h3><p>This record is not available in the local shop data.</p><Link className="button" href="/customers">Return to customers</Link></div></section>;
  const sales = store.sales.filter((sale) => sale.customer?.id === id);
  return <><div className="page-heading"><div><Link className="back-link" href="/customers"><ArrowLeft size={14} weight="bold" /> Customers</Link><h1 className="page-title">{customer.name}</h1><p className="page-copy">{customer.phone}{customer.email ? ` · ${customer.email}` : ""}</p></div>{customer.trn && <span className="badge blue">TRN {customer.trn}</span>}</div><div className="grid-two customer-detail-grid"><section className="panel"><div className="panel-header"><div><div className="panel-title">Purchase history</div><div className="panel-subtitle">{sales.length} linked invoices · {formatAED(sales.reduce((sum, sale) => sum + sale.grossFils, 0))}</div></div></div>{sales.length ? <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Issued</th><th>Payment</th><th className="numeric">Total</th></tr></thead><tbody>{sales.map((sale) => <tr key={sale.id}><td><Link className="invoice-link" href={`/sales/${sale.id}`}>{sale.invoiceNumber}</Link></td><td>{formatDateTime(sale.createdAt)}</td><td><span className={`badge ${sale.paymentMethod === "cash" ? "green" : "blue"}`}>{sale.paymentMethod}</span></td><td className="numeric product-name">{formatAED(sale.grossFils)}</td></tr>)}</tbody></table></div> : <EmptyState icon={<Receipt size={30} weight="duotone" />} title="No purchases yet" hint="Select this customer during checkout to create a linked invoice." action={<Link className="button primary" href="/sale">Start a sale</Link>} />}</section><aside className="panel"><div className="panel-header"><div><div className="panel-title">Contact record</div><div className="panel-subtitle">Current details</div></div></div><div className="panel-body detail-list"><div><span>Phone</span><strong>{customer.phone}</strong></div><div><span>Email</span><strong>{customer.email ?? "Not provided"}</strong></div><div><span>Address</span><strong>{customer.address ?? "Not provided"}</strong></div><div><span>TRN</span><strong>{customer.trn ?? "Not provided"}</strong></div></div></aside></div></>;
}
