"use client";

import { Archive, ArrowCounterClockwise, DownloadSimple, MagnifyingGlass, PencilSimple, Plus, Truck, WarningCircle } from "@/components/icons";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/list-parts";
import { useListParams } from "@/components/ui/use-list-params";
import { PurchasingGate } from "@/components/purchasing/purchasing-gate";
import { SupplierForm } from "@/components/purchasing/supplier-form";
import { formatAED } from "@/lib/domain";
import { periodRange, type PeriodKey } from "@/lib/profit/math";
import { listReceipts, listSuppliers, saveSupplier } from "@/lib/purchasing/client";
import { purchasesCsv } from "@/lib/purchasing/csv";
import type { ReceiptSummary, Supplier } from "@/lib/purchasing/types";
import { toast } from "@/lib/ui/toast-store";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this-week", label: "This week" },
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
];

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Stage 2D: deliveries and suppliers (owner and manager on Pro, online). */
export function PurchasesWorkspace() {
  const [params, setParams] = useListParams({ tab: "deliveries" });
  const tab = params.tab === "suppliers" ? "suppliers" : "deliveries";
  return <>
    <div className="page-heading"><div><div className="eyebrow">Suppliers and deliveries</div><h1 className="page-title">Purchases</h1><p className="page-copy">Record what arrives from suppliers. Each delivery adds stock and updates the product&apos;s average cost.</p></div>
      <div className="page-actions"><Link className="button primary" href="/purchases/new"><Plus size={15} weight="bold" /> Record delivery</Link></div></div>
    <div className="segmented report-tabs" role="tablist" aria-label="Purchases">
      <button type="button" role="tab" aria-selected={tab === "deliveries"} className={`button ${tab === "deliveries" ? "primary" : ""}`} onClick={() => setParams({ tab: "deliveries" })}>Deliveries</button>
      <button type="button" role="tab" aria-selected={tab === "suppliers"} className={`button ${tab === "suppliers" ? "primary" : ""}`} onClick={() => setParams({ tab: "suppliers" })}>Suppliers</button>
    </div>
    <PurchasingGate>{tab === "deliveries" ? <DeliveriesTab /> : <SuppliersTab />}</PurchasingGate>
  </>;
}

function useSuppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    void listSuppliers().then((result) => {
      if (!live) return;
      if (result.ok) {
        setSuppliers(result.suppliers);
        setError("");
      } else setError(result.error);
    });
    return () => { live = false; };
  }, [version]);
  return { suppliers, error, reload: () => setVersion((value) => value + 1) };
}

function DeliveriesTab() {
  const [period, setPeriod] = useState<PeriodKey>("this-month");
  const [supplierId, setSupplierId] = useState("");
  const { suppliers } = useSuppliers();
  const range = useMemo(() => periodRange(period, new Date()), [period]);
  const key = `${range.from}:${range.to}:${supplierId}`;
  const [result, setResult] = useState<{ key: string; receipts?: ReceiptSummary[]; error?: string } | null>(null);

  useEffect(() => {
    let live = true;
    void listReceipts(range.from, range.to, supplierId || undefined).then((response) => {
      if (live) setResult(response.ok ? { key, receipts: response.receipts } : { key, error: response.error });
    });
    return () => { live = false; };
  }, [key, range.from, range.to, supplierId]);

  const current = result?.key === key ? result : null;
  const receipts = current?.receipts;
  return <section className="panel">
    <div className="panel-body"><div className="toolbar profit-periods">
      <div className="segmented" role="radiogroup" aria-label="Period">{PERIODS.map((item) => <button key={item.key} type="button" role="radio" aria-checked={period === item.key} className={`button ${period === item.key ? "primary" : ""}`} onClick={() => setPeriod(item.key)}>{item.label}</button>)}</div>
      <select className="select category-filter" aria-label="Supplier" value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
        <option value="">All suppliers</option>
        {(suppliers ?? []).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}{supplier.archived ? " (archived)" : ""}</option>)}
      </select>
      <button type="button" className="button" disabled={!receipts?.length} onClick={() => receipts && download(`billo-purchases-${range.from}-${range.to}.csv`, purchasesCsv(receipts))}><DownloadSimple size={15} weight="bold" /> Download CSV</button>
    </div></div>
    {current?.error ? <div className="notice error-notice" role="alert"><WarningCircle size={18} weight="fill" /><span>{current.error}</span></div> : null}
    {!current ? <p className="field-hint panel-body" role="status">Loading deliveries…</p>
      : receipts?.length ? (
        <div className="table-wrap stack-table"><table><thead><tr><th>Date</th><th>Supplier</th><th>Invoice no.</th><th className="numeric">Lines</th><th className="numeric">Net</th><th className="numeric">VAT</th><th className="numeric">Total</th></tr></thead>
          <tbody>{receipts.map((row) => (
            <tr key={row.id}>
              <td data-label="Date"><Link className="invoice-link" href={`/purchases/${row.id}`}>{row.invoiceDate}</Link>{row.voidedAt ? <> <span className="badge yellow">Voided</span></> : null}</td>
              <td data-label="Supplier"><Link href={`/purchases/suppliers/${row.supplierId}`}>{row.supplierName}</Link></td>
              <td data-label="Invoice no.">{row.supplierInvoice ?? "—"}</td>
              <td data-label="Lines" className="numeric">{row.lineCount}</td>
              <td data-label="Net" className="numeric">{formatAED(row.netFils)}</td>
              <td data-label="VAT" className="numeric">{formatAED(row.vatFils)}</td>
              <td data-label="Total" className="numeric product-name">{formatAED(row.grossFils)}</td>
            </tr>))}</tbody></table></div>
      ) : current.error ? null : <EmptyState icon={<Truck size={28} weight="duotone" />} title="No deliveries in this period" hint="Record a delivery when goods arrive from a supplier." action={<Link className="button primary" href="/purchases/new">Record delivery</Link>} />}
  </section>;
}

function SuppliersTab() {
  const { suppliers, error, reload } = useSuppliers();
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const [pageError, setPageError] = useState("");
  const term = query.trim().toLowerCase();
  const visible = (suppliers ?? []).filter((supplier) => (showArchived || !supplier.archived) && (!term || [supplier.name, supplier.trn, supplier.phone].some((value) => value?.toLowerCase().includes(term))));

  async function setArchived(supplier: Supplier, archived: boolean) {
    const result = await saveSupplier({ ...supplier, archived });
    setPageError(result.ok ? "" : result.error);
    if (result.ok) {
      toast(archived ? "Supplier archived" : "Supplier restored");
      reload();
    }
  }

  return <section className="panel">
    <div className="panel-body"><div className="toolbar">
      <div className="search"><MagnifyingGlass size={16} weight="bold" /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, TRN or phone" aria-label="Search suppliers" /></div>
      <button type="button" className={`button ${showArchived ? "primary" : ""}`} aria-pressed={showArchived} onClick={() => setShowArchived((value) => !value)}>Show archived</button>
      <button type="button" className="button primary" onClick={() => setEditing("new")}><Plus size={15} weight="bold" /> Add supplier</button>
    </div></div>
    {error || pageError ? <div className="notice error-notice" role="alert"><WarningCircle size={18} weight="fill" /><span>{error || pageError}</span></div> : null}
    {suppliers === null && !error ? <p className="field-hint panel-body" role="status">Loading suppliers…</p>
      : visible.length ? (
        <div className="table-wrap stack-table"><table><thead><tr><th>Supplier</th><th>TRN</th><th>Phone</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{visible.map((supplier) => (
            <tr key={supplier.id}>
              <td data-label="Supplier"><Link className="product-name" href={`/purchases/suppliers/${supplier.id}`}>{supplier.name}</Link>{supplier.archived ? <> <span className="badge yellow">Archived</span></> : null}</td>
              <td data-label="TRN">{supplier.trn ?? "—"}</td>
              <td data-label="Phone">{supplier.phone ?? "—"}</td>
              <td className="numeric row-actions-cell"><div className="row-actions">
                <button type="button" className="button" onClick={() => setEditing(supplier)} aria-label={`Edit ${supplier.name}`}><PencilSimple size={14} weight="bold" /> Edit</button>
                {supplier.archived
                  ? <button type="button" className="button" onClick={() => void setArchived(supplier, false)} aria-label={`Restore ${supplier.name}`}><ArrowCounterClockwise size={14} weight="bold" /> Restore</button>
                  : <button type="button" className="button" onClick={() => void setArchived(supplier, true)} aria-label={`Archive ${supplier.name}`}><Archive size={14} weight="bold" /> Archive</button>}
              </div></td>
            </tr>))}</tbody></table></div>
      ) : <EmptyState icon={<Truck size={28} weight="duotone" />} title={suppliers?.length ? "No suppliers match" : "No suppliers yet"} hint={suppliers?.length ? "Try another name, TRN or phone." : "Add the companies you buy from."} />}
    {editing ? <SupplierForm supplier={editing === "new" ? undefined : editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); toast("Supplier saved"); reload(); }} /> : null}
  </section>;
}
