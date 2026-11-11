"use client";

import { ArrowLeft, PencilSimple, Truck, WarningCircle } from "@/components/icons";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, SummaryStrip } from "@/components/ui/list-parts";
import { PurchasingGate } from "@/components/purchasing/purchasing-gate";
import { SupplierForm } from "@/components/purchasing/supplier-form";
import { formatAED } from "@/lib/domain";
import { periodRange } from "@/lib/profit/math";
import { listReceipts, listSuppliers } from "@/lib/purchasing/client";
import type { ReceiptSummary, Supplier } from "@/lib/purchasing/types";
import { uaeBusinessDate } from "@/lib/reporting";

function daysBefore(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - days)).toISOString().slice(0, 10);
}

/** Stage 2D: one supplier, with its deliveries of the last 90 days. */
export function SupplierPage({ id }: { id: string }) {
  return <>
    <div className="page-heading"><div><Link className="back-link" href="/purchases?tab=suppliers"><ArrowLeft size={14} weight="bold" /> Suppliers</Link><h1 className="page-title">Supplier</h1></div></div>
    <PurchasingGate><SupplierBody id={id} /></PurchasingGate>
  </>;
}

function SupplierBody({ id }: { id: string }) {
  const [supplier, setSupplier] = useState<Supplier | null | undefined>(undefined);
  const [receipts, setReceipts] = useState<ReceiptSummary[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    const today = uaeBusinessDate(new Date());
    void Promise.all([listSuppliers(), listReceipts(daysBefore(today, 90), today, id)]).then(([suppliers, list]) => {
      if (!live) return;
      if (!suppliers.ok) return setError(suppliers.error);
      setSupplier(suppliers.suppliers.find((item) => item.id === id) ?? null);
      if (list.ok) setReceipts(list.receipts);
      else setError(list.error);
    });
    return () => { live = false; };
  }, [id, version]);

  if (error) return <div className="notice error-notice" role="alert"><WarningCircle size={18} weight="fill" /><span>{error}</span></div>;
  if (supplier === undefined) return <p className="field-hint" role="status">Loading supplier…</p>;
  if (supplier === null) return <EmptyState icon={<Truck size={28} weight="duotone" />} title="Supplier not found" hint="It may belong to another shop." action={<Link className="button" href="/purchases?tab=suppliers">Back to suppliers</Link>} />;

  const live = (receipts ?? []).filter((row) => !row.voidedAt);
  const month = periodRange("this-month", new Date());
  const monthTotal = live.filter((row) => row.invoiceDate >= month.from).reduce((sum, row) => sum + row.grossFils, 0);
  const total90 = live.reduce((sum, row) => sum + row.grossFils, 0);

  return <>
    <section className="panel">
      <div className="panel-header"><div><div className="panel-title">{supplier.name}{supplier.archived ? <> <span className="badge yellow">Archived</span></> : null}</div><div className="panel-subtitle">{[supplier.trn ? `TRN ${supplier.trn}` : null, supplier.phone, supplier.email].filter(Boolean).join(" · ") || "No contact details"}</div></div>
        <button type="button" className="button" onClick={() => setEditing(true)}><PencilSimple size={14} weight="bold" /> Edit</button></div>
      {supplier.note ? <div className="panel-body"><p className="field-hint">{supplier.note}</p></div> : null}
    </section>
    <SummaryStrip label="Purchases from this supplier" items={[{ label: "This month", value: formatAED(monthTotal) }, { label: "Last 90 days", value: formatAED(total90) }, { label: "Deliveries", value: String(live.length) }]} />
    <section className="panel">
      <div className="panel-header"><div><div className="panel-title">Deliveries</div><div className="panel-subtitle">Last 90 days</div></div></div>
      {receipts?.length ? (
        <div className="table-wrap stack-table"><table><thead><tr><th>Date</th><th>Invoice no.</th><th className="numeric">Lines</th><th className="numeric">Total</th></tr></thead>
          <tbody>{receipts.map((row) => <tr key={row.id}><td data-label="Date"><Link className="invoice-link" href={`/purchases/${row.id}`}>{row.invoiceDate}</Link>{row.voidedAt ? <> <span className="badge yellow">Voided</span></> : null}</td><td data-label="Invoice no.">{row.supplierInvoice ?? "—"}</td><td data-label="Lines" className="numeric">{row.lineCount}</td><td data-label="Total" className="numeric">{formatAED(row.grossFils)}</td></tr>)}</tbody></table></div>
      ) : <div className="panel-body"><p className="field-hint">No deliveries from this supplier in the last 90 days.</p></div>}
    </section>
    {editing ? <SupplierForm supplier={supplier} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); setVersion((value) => value + 1); }} /> : null}
  </>;
}
