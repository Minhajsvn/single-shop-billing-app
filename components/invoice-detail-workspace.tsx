"use client";

import { ArrowCounterClockwise, ArrowLeft, FilePdf, Printer, Receipt, X } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { READ_ONLY_REASON, useEntitlement } from "@/components/billing/use-entitlement";
import { useOnline } from "@/components/offline-runtime";
import { ReceiptDocument, lineSaving, useReceiptShop } from "@/components/receipt-document";
import { useFoundSale } from "@/components/sales/use-invoice-lookup";
import { useRemoteSale } from "@/components/sales/use-remote-sale";
import { isOwnerView } from "@/lib/access/cashier";
import { createCreditNote, useDemoStore, useShopContext } from "@/lib/demo-store";
import { refundedQuantities } from "@/lib/sales/invoice-lookup";
import { formatAED, formatDateTime } from "@/lib/domain";
import { printDocument } from "@/lib/print";

export function InvoiceDetailWorkspace({ id }: { id: string }) {
  const store = useDemoStore();
  const pathname = usePathname();
  const routeId = pathname.split("/").filter(Boolean).at(-1) ?? id;
  const localSale = store.sales.find((item) => item.id === routeId);
  const online = useOnline();
  // Sales older than the browser's 90-day history are loaded from the server to view and reprint only (owner).
  // A sale found by its invoice number ("Refund a sale by invoice number") can also be refunded (owner decision 8).
  const { mode, role } = useShopContext();
  const ownerView = isOwnerView(role);
  const remote = useRemoteSale(routeId, !localSale && mode === "hosted" && ownerView, online);
  const foundSale = useFoundSale(routeId, !localSale && mode === "hosted" && !ownerView, online);
  const found = foundSale.lookup ?? undefined;
  const sale = localSale ?? remote.sale ?? found?.sale ?? undefined;
  const viewOnly = !localSale && !found && Boolean(remote.sale);
  const remoteStatus = ownerView ? remote.status : foundSale.status;
  const shop = useReceiptShop(sale);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [returnError, setReturnError] = useState("");
  const { canWrite } = useEntitlement();


  const print = printDocument;

  if (!sale) {
    if (mode === "hosted" && (remoteStatus === "loading" || (online && remoteStatus === "idle"))) return <section className="panel"><div className="empty"><Receipt size={32} weight="duotone" /><h3>Loading invoice…</h3><p>Fetching this older invoice from the server.</p></div></section>;
    return <section className="panel"><div className="empty"><Receipt size={32} weight="duotone" /><h3>Invoice not found</h3><p>{online ? "The invoice may not exist in this shop." : "Connect to the internet to open older invoices."}</p><Link className="button" href="/sales">Return to sales</Link></div></section>;
  }

  const localNotes = store.creditNotes.filter((note) => note.saleId === sale.id);
  // A sale found by invoice number also lists the server's credit notes this browser does not hold.
  const localIds = new Set(localNotes.map((note) => note.id));
  const creditNotes = [
    ...localNotes.map((note) => ({ id: note.id, creditNoteNumber: note.creditNoteNumber, createdAt: note.createdAt, grossFils: note.grossFils, items: note.lines.reduce((sum, item) => sum + item.quantity, 0) })),
    ...(found?.creditNotes ?? []).filter((note) => !localIds.has(note.id)).map((note) => ({ id: note.id, creditNoteNumber: note.creditNoteNumber, createdAt: note.createdAt, grossFils: note.grossFils, items: note.lines.reduce((sum, item) => sum + item.quantity, 0) })),
  ];
  const returned = refundedQuantities(sale.id, store.creditNotes, found?.creditNotes);
  // Refunds for sales this browser holds or found by invoice number; older invoices opened otherwise are view and reprint only.
  const hasReturnableLines = !viewOnly && sale.lines.some((item) => item.quantity > (returned.get(item.id) ?? 0));

  function createReturn() {
    const result = createCreditNote(sale!.id, returnQuantities, found);
    if (!result.ok) return setReturnError(result.error);
    setReturnOpen(false);
    setReturnQuantities({});
    setReturnError("");
  }

  return (
    <>
      <div className="page-heading no-print"><div><Link className="back-link" href="/sales"><ArrowLeft size={14} weight="bold" /> Sales ledger</Link><h1 className="page-title invoice-title">{sale.invoiceNumber}</h1><p className="page-copy">Issued {formatDateTime(sale.createdAt)} · immutable completed invoice</p>{viewOnly ? <p className="field-hint">Refunds are available for sales in the last 90 days.</p> : null}{hasReturnableLines && !canWrite ? <p className="field-hint">{READ_ONLY_REASON} Printing still works.</p> : null}</div><div className="invoice-actions">{hasReturnableLines && <button className="button" onClick={() => setReturnOpen(true)} disabled={!canWrite} title={canWrite ? undefined : READ_ONLY_REASON}><ArrowCounterClockwise size={16} weight="bold" /> Return items</button>}<button className="button" onClick={() => print("receipt")}><Printer size={16} weight="bold" /> Print 80mm</button><button className="button primary" onClick={() => print("a4")}><FilePdf size={16} weight="bold" /> Print / Save A4 PDF</button></div></div>

      <article className="panel invoice-document a4-document">
        <header className="invoice-header"><div><div className="invoice-wordmark">{shop.name}</div><div className="invoice-address">{shop.address}<br />{shop.phone}<br />TRN {shop.trn}</div></div><div className="invoice-heading"><span>{sale.customer?.trn ? "Full Tax Invoice" : "Tax Invoice"}</span><strong>{sale.invoiceNumber}</strong><small>Supply date {sale.supplyDate}</small></div></header>
        {sale.customer && <section className="invoice-customer"><span>Bill to</span><strong>{sale.customer.name}</strong><p>{sale.customer.address ?? sale.customer.phone}{sale.customer.address ? <><br />{sale.customer.phone}</> : null}{sale.customer.email ? <><br />{sale.customer.email}</> : null}{sale.customer.trn ? <><br />TRN {sale.customer.trn}</> : null}</p></section>}
        <div className="invoice-meta-grid"><div><span>Issued</span><strong>{formatDateTime(sale.createdAt)}</strong></div><div><span>Payment</span><strong>{sale.paymentMethod === "cash" ? "Cash" : "Card"}</strong></div><div><span>Currency</span><strong>AED</strong></div><div><span>Status</span><strong>Paid</strong></div></div>
        <div className="table-wrap"><table className="invoice-table"><thead><tr><th>Description</th><th className="numeric">Qty</th><th className="numeric">Unit incl. VAT</th><th className="numeric">Net</th><th className="numeric">VAT 5%</th><th className="numeric">Total</th></tr></thead><tbody>{sale.lines.map((item) => <tr key={item.id}><td><div className="product-name">{item.name}</div><div className="product-meta">{item.sku ?? "Non-stock item"}</div>{item.listUnitGrossFils ? <div className="product-meta">List {formatAED(item.listUnitGrossFils)} · discount {formatAED(lineSaving(item))}</div> : null}</td><td className="numeric">{item.quantity}</td><td className="numeric">{formatAED(item.unitGrossFils)}</td><td className="numeric">{formatAED(item.netFils)}</td><td className="numeric">{formatAED(item.vatFils)}</td><td className="numeric product-name">{formatAED(item.grossFils)}</td></tr>)}</tbody></table></div>
        <footer className="invoice-footer"><div className="invoice-note"><strong>Thank you.</strong><span>{shop.footer}</span></div><div className="invoice-totals"><div><span>Net amount</span><strong>{formatAED(sale.netFils)}</strong></div><div><span>VAT 5%</span><strong>{formatAED(sale.vatFils)}</strong></div><div className="grand-total"><span>Total paid</span><strong>{formatAED(sale.grossFils)}</strong></div></div></footer>
      </article>

      {creditNotes.length > 0 && <section className="panel credit-note-history no-print"><div className="panel-header"><div><div className="panel-title">Credit notes</div><div className="panel-subtitle">Refund documents linked to this invoice</div></div></div><div className="credit-note-list">{creditNotes.map((note) => <div className="credit-note-row" key={note.id}><div><strong>{note.creditNoteNumber}</strong><span>{formatDateTime(note.createdAt)} · {note.items} items</span></div><strong>−{formatAED(note.grossFils)}</strong></div>)}</div></section>}

      <ReceiptDocument sale={sale} shop={shop} />

      {returnOpen && canWrite && <div className="modal-backdrop no-print" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReturnOpen(false); }}><div className="modal"><div className="modal-header"><div><div className="panel-title">Create credit note</div><div className="panel-subtitle">Refund via {sale.paymentMethod} and restore stock for inventory items.</div></div><button className="button icon-only" onClick={() => setReturnOpen(false)} aria-label="Close"><X size={16} weight="bold" /></button></div><div className="return-lines">{sale.lines.map((item) => {
        const remaining = item.quantity - (returned.get(item.id) ?? 0);
        return <div className={`return-line ${remaining === 0 ? "disabled" : ""}`} key={item.id}><div><strong>{item.name}</strong><span>{remaining} of {item.quantity} available · {formatAED(item.unitGrossFils)} each</span></div><div className="field return-quantity"><label htmlFor={`return-${item.id}`}>Return qty</label><input className="input" id={`return-${item.id}`} type="number" min="0" max={remaining} value={returnQuantities[item.id] ?? 0} disabled={remaining === 0} onChange={(event) => setReturnQuantities((current) => ({ ...current, [item.id]: Number(event.target.value) }))} /></div></div>;
      })}{returnError && <p className="form-error">{returnError}</p>}</div><div className="modal-footer"><button className="button" onClick={() => setReturnOpen(false)}>Cancel</button><button className="button primary" onClick={createReturn}>Issue credit note</button></div></div></div>}
    </>
  );
}
