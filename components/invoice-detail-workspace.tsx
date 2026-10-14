"use client";

import { ArrowCounterClockwise, ArrowLeft, FilePdf, Printer, Receipt, X } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createCreditNote, useDemoStore, useShopContext } from "@/lib/demo-store";
import { formatAED, formatDateTime } from "@/lib/domain";

const SETTINGS_KEY = "shop-ledger-demo-settings-v1";
const defaultShop = { name: "Al Noor Corner Shop", trn: "100000000000003", phone: "+971 4 555 0184", address: "Dubai, United Arab Emirates", footer: "Thank you for shopping with us." };

export function InvoiceDetailWorkspace({ id }: { id: string }) {
  const store = useDemoStore();
  const pathname = usePathname();
  const routeId = pathname.split("/").filter(Boolean).at(-1) ?? id;
  const sale = store.sales.find((item) => item.id === routeId);
  const { mode, business } = useShopContext();
  const [savedShop, setSavedShop] = useState(defaultShop);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [returnError, setReturnError] = useState("");

  // Browser-only stores keep their shop details in localStorage; hosted shops use the server copy.
  useEffect(() => {
    if (mode === "hosted") return;
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(SETTINGS_KEY);
        if (saved) setSavedShop({ ...defaultShop, ...JSON.parse(saved) });
      } catch { /* keep defaults */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [mode]);
  const footer = business?.receiptFooter ?? (mode === "hosted" ? "" : savedShop.footer);
  // An issued invoice shows the supplier details captured when it was synced, never later edits.
  const shop = sale?.supplier
    ? { name: sale.supplier.name, trn: sale.supplier.trn, address: sale.supplier.address, phone: sale.supplier.phone, footer }
    : business
      ? { name: business.legalName, trn: business.trn, address: business.address, phone: business.phone, footer }
      : mode === "hosted" ? { name: "", trn: "", address: "", phone: "", footer } : savedShop;

  function print(mode: "receipt" | "a4") {
    document.documentElement.dataset.printMode = mode;
    window.setTimeout(() => window.print(), 0);
    window.addEventListener("afterprint", () => delete document.documentElement.dataset.printMode, { once: true });
  }

  if (!sale) {
    return <section className="panel"><div className="empty"><Receipt size={32} weight="duotone" /><h3>Invoice not found</h3><p>The invoice may not exist in this browser’s local demo data.</p><Link className="button" href="/sales">Return to sales</Link></div></section>;
  }

  const creditNotes = store.creditNotes.filter((note) => note.saleId === sale.id);
  const returned = new Map<string, number>();
  for (const note of creditNotes) for (const item of note.lines) returned.set(item.originalLineId, (returned.get(item.originalLineId) ?? 0) + item.quantity);
  const hasReturnableLines = sale.lines.some((item) => item.quantity > (returned.get(item.id) ?? 0));

  function createReturn() {
    const result = createCreditNote(sale!.id, returnQuantities);
    if (!result.ok) return setReturnError(result.error);
    setReturnOpen(false);
    setReturnQuantities({});
    setReturnError("");
  }

  return (
    <>
      <div className="page-heading no-print"><div><Link className="back-link" href="/sales"><ArrowLeft size={14} weight="bold" /> Sales ledger</Link><h1 className="page-title invoice-title">{sale.invoiceNumber}</h1><p className="page-copy">Issued {formatDateTime(sale.createdAt)} · immutable completed invoice</p></div><div className="invoice-actions">{hasReturnableLines && <button className="button" onClick={() => setReturnOpen(true)}><ArrowCounterClockwise size={16} weight="bold" /> Return items</button>}<button className="button" onClick={() => print("receipt")}><Printer size={16} weight="bold" /> Print 80mm</button><button className="button primary" onClick={() => print("a4")}><FilePdf size={16} weight="bold" /> Print / Save A4 PDF</button></div></div>

      <article className="panel invoice-document a4-document">
        <header className="invoice-header"><div><div className="invoice-wordmark">{shop.name}</div><div className="invoice-address">{shop.address}<br />{shop.phone}<br />TRN {shop.trn}</div></div><div className="invoice-heading"><span>{sale.customer?.trn ? "Full Tax Invoice" : "Tax Invoice"}</span><strong>{sale.invoiceNumber}</strong><small>Supply date {sale.supplyDate}</small></div></header>
        {sale.customer && <section className="invoice-customer"><span>Bill to</span><strong>{sale.customer.name}</strong><p>{sale.customer.address ?? sale.customer.phone}{sale.customer.address ? <><br />{sale.customer.phone}</> : null}{sale.customer.email ? <><br />{sale.customer.email}</> : null}{sale.customer.trn ? <><br />TRN {sale.customer.trn}</> : null}</p></section>}
        <div className="invoice-meta-grid"><div><span>Issued</span><strong>{formatDateTime(sale.createdAt)}</strong></div><div><span>Payment</span><strong>{sale.paymentMethod === "cash" ? "Cash" : "Card"}</strong></div><div><span>Currency</span><strong>AED</strong></div><div><span>Status</span><strong>Paid</strong></div></div>
        <div className="table-wrap"><table className="invoice-table"><thead><tr><th>Description</th><th className="numeric">Qty</th><th className="numeric">Unit incl. VAT</th><th className="numeric">Net</th><th className="numeric">VAT 5%</th><th className="numeric">Total</th></tr></thead><tbody>{sale.lines.map((item) => <tr key={item.id}><td><div className="product-name">{item.name}</div><div className="product-meta">{item.sku ?? "Non-stock item"}</div></td><td className="numeric">{item.quantity}</td><td className="numeric">{formatAED(item.unitGrossFils)}</td><td className="numeric">{formatAED(item.netFils)}</td><td className="numeric">{formatAED(item.vatFils)}</td><td className="numeric product-name">{formatAED(item.grossFils)}</td></tr>)}</tbody></table></div>
        <footer className="invoice-footer"><div className="invoice-note"><strong>Thank you.</strong><span>{shop.footer}</span></div><div className="invoice-totals"><div><span>Net amount</span><strong>{formatAED(sale.netFils)}</strong></div><div><span>VAT 5%</span><strong>{formatAED(sale.vatFils)}</strong></div><div className="grand-total"><span>Total paid</span><strong>{formatAED(sale.grossFils)}</strong></div></div></footer>
      </article>

      {creditNotes.length > 0 && <section className="panel credit-note-history no-print"><div className="panel-header"><div><div className="panel-title">Credit notes</div><div className="panel-subtitle">Refund documents linked to this invoice</div></div></div><div className="credit-note-list">{creditNotes.map((note) => <div className="credit-note-row" key={note.id}><div><strong>{note.creditNoteNumber}</strong><span>{formatDateTime(note.createdAt)} · {note.lines.reduce((sum, item) => sum + item.quantity, 0)} items</span></div><strong>−{formatAED(note.grossFils)}</strong></div>)}</div></section>}

      <article className="receipt-document">
        <header><h1>{shop.name}</h1><p>{shop.address}<br />{shop.phone}<br />TRN {shop.trn}</p><h2>Tax Invoice</h2></header>
        <div className="receipt-meta"><div><span>Invoice</span><strong>{sale.invoiceNumber}</strong></div><div><span>Issued</span><strong>{formatDateTime(sale.createdAt)}</strong></div><div><span>Payment</span><strong>{sale.paymentMethod === "cash" ? "Cash" : "Card"}</strong></div></div>
        <div className="receipt-lines">{sale.lines.map((item) => <div className="receipt-line" key={item.id}><div><strong>{item.name}</strong><span>{item.quantity} × {formatAED(item.unitGrossFils)}</span></div><strong>{formatAED(item.grossFils)}</strong></div>)}</div>
        <div className="receipt-totals"><div><span>Net</span><strong>{formatAED(sale.netFils)}</strong></div><div><span>VAT 5%</span><strong>{formatAED(sale.vatFils)}</strong></div><div className="receipt-grand"><span>Total</span><strong>{formatAED(sale.grossFils)}</strong></div></div>
        <footer>{shop.footer}</footer>
      </article>

      {returnOpen && <div className="modal-backdrop no-print" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReturnOpen(false); }}><div className="modal"><div className="modal-header"><div><div className="panel-title">Create credit note</div><div className="panel-subtitle">Refund via {sale.paymentMethod} and restore stock for inventory items.</div></div><button className="button icon-only" onClick={() => setReturnOpen(false)} aria-label="Close"><X size={16} weight="bold" /></button></div><div className="return-lines">{sale.lines.map((item) => {
        const remaining = item.quantity - (returned.get(item.id) ?? 0);
        return <div className={`return-line ${remaining === 0 ? "disabled" : ""}`} key={item.id}><div><strong>{item.name}</strong><span>{remaining} of {item.quantity} available · {formatAED(item.unitGrossFils)} each</span></div><div className="field return-quantity"><label htmlFor={`return-${item.id}`}>Return qty</label><input className="input" id={`return-${item.id}`} type="number" min="0" max={remaining} value={returnQuantities[item.id] ?? 0} disabled={remaining === 0} onChange={(event) => setReturnQuantities((current) => ({ ...current, [item.id]: Number(event.target.value) }))} /></div></div>;
      })}{returnError && <p className="form-error">{returnError}</p>}</div><div className="modal-footer"><button className="button" onClick={() => setReturnOpen(false)}>Cancel</button><button className="button primary" onClick={createReturn}>Issue credit note</button></div></div></div>}
    </>
  );
}
