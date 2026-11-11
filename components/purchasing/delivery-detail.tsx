"use client";

import { ArrowLeft, Truck, WarningCircle, X } from "@/components/icons";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { EmptyState } from "@/components/ui/list-parts";
import { PurchasingGate } from "@/components/purchasing/purchasing-gate";
import { refreshSnapshot } from "@/lib/demo-store";
import { formatAED, formatDateTime } from "@/lib/domain";
import { getReceipt, voidReceipt } from "@/lib/purchasing/client";
import type { ReceiptDetail } from "@/lib/purchasing/types";
import { toast } from "@/lib/ui/toast-store";

/** Stage 2D: one delivery, its lines with cost before and after, and Void. */
export function DeliveryDetail({ id }: { id: string }) {
  return <>
    <div className="page-heading"><div><Link className="back-link" href="/purchases"><ArrowLeft size={14} weight="bold" /> Purchases</Link><h1 className="page-title">Delivery</h1></div></div>
    <PurchasingGate><DeliveryBody id={id} /></PurchasingGate>
  </>;
}

function DeliveryBody({ id }: { id: string }) {
  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null);
  const [error, setError] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    void getReceipt(id).then((result) => {
      if (!live) return;
      if (result.ok) setReceipt(result.receipt);
      else setError(result.error);
    });
    return () => { live = false; };
  }, [id, version]);

  if (error && !receipt) return <EmptyState icon={<Truck size={28} weight="duotone" />} title="Delivery not available" hint={error} action={<Link className="button" href="/purchases">Back to purchases</Link>} />;
  if (!receipt) return <p className="field-hint" role="status">Loading delivery…</p>;

  return <>
    <section className="panel">
      <div className="panel-header"><div>
        <div className="panel-title">{receipt.supplierName}{receipt.voidedAt ? <> <span className="badge yellow">Voided</span></> : null}</div>
        <div className="panel-subtitle">{receipt.invoiceDate}{receipt.supplierInvoice ? ` · Invoice ${receipt.supplierInvoice}` : ""}{receipt.supplierTrn ? ` · TRN ${receipt.supplierTrn}` : ""} · recorded {formatDateTime(receipt.createdAt)}</div>
      </div>{receipt.voidedAt ? null : <button type="button" className="button" onClick={() => setVoiding(true)}>Void delivery</button>}</div>
      {receipt.voidedAt ? <div className="panel-body"><p className="field-hint">Voided {formatDateTime(receipt.voidedAt)}: {receipt.voidReason}. Stock was taken back out; costs were left as they were.</p></div> : null}
      <div className="table-wrap stack-table"><table><thead><tr><th>Product</th><th className="numeric">Qty</th><th className="numeric">Unit cost excl. VAT</th><th className="numeric">Line</th><th className="numeric">Cost before → after</th></tr></thead>
        <tbody>{receipt.lines.map((line) => <tr key={line.productId}>
          <td data-label="Product"><div className="product-name">{line.productName}</div><div className="product-meta">{line.sku}</div></td>
          <td data-label="Qty" className="numeric">{line.quantity}</td>
          <td data-label="Unit cost" className="numeric">{formatAED(line.unitCostFils)}</td>
          <td data-label="Line" className="numeric">{formatAED(line.lineNetFils)}</td>
          <td data-label="Cost" className="numeric">{line.costBeforeFils === null ? "—" : formatAED(line.costBeforeFils)} → {formatAED(line.costAfterFils)}</td>
        </tr>)}</tbody></table></div>
      <div className="panel-body delivery-totals"><div><span>Net</span><strong>{formatAED(receipt.netFils)}</strong></div><div><span>VAT</span><strong>{formatAED(receipt.vatFils)}</strong></div><div><span>Total</span><strong>{formatAED(receipt.grossFils)}</strong></div></div>
    </section>
    {voiding ? <VoidDialog receipt={receipt} onClose={() => setVoiding(false)} onVoided={() => { setVoiding(false); setVersion((value) => value + 1); void refreshSnapshot(); toast("Delivery voided"); }} /> : null}
  </>;
}

function VoidDialog({ receipt, onClose, onVoided }: { receipt: ReceiptDetail; onClose: () => void; onVoided: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (!reason) return setError("Give a reason.");
    setBusy(true);
    const result = await voidReceipt(receipt.id, reason);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    onVoided();
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
    <form className="modal" onSubmit={submit} aria-label="Void delivery">
      <div className="modal-header"><div><div className="panel-title">Void this delivery?</div><div className="panel-subtitle">{receipt.lines.length} {receipt.lines.length === 1 ? "line" : "lines"} come back out of stock. Costs stay as they are; change one by hand in Inventory if needed.</div></div><button type="button" className="button icon-only" onClick={onClose} aria-label="Close"><X size={16} weight="bold" /></button></div>
      <div className="modal-body"><div className="field"><label htmlFor="void-reason">Reason</label><textarea className="textarea" id="void-reason" name="reason" maxLength={200} required autoFocus placeholder="Wrong supplier, entered twice…" /></div>
        {error ? <p className="form-error" role="alert"><WarningCircle size={14} weight="fill" /> {error}</p> : null}</div>
      <div className="modal-footer"><button type="button" className="button" onClick={onClose}>Cancel</button><button className="button primary" type="submit" disabled={busy}>Void delivery</button></div>
    </form>
  </div>;
}
