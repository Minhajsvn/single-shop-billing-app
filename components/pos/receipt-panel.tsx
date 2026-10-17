"use client";

import { CheckCircle, FilePdf, Plus, Printer } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { ReceiptDocument, type ReceiptShop } from "@/components/receipt-document";
import { changeDue } from "@/lib/checkout/pricing";
import { formatAED, type Sale } from "@/lib/domain";
import { printDocument } from "@/lib/print";

/** Shown in place of the cart after a sale, so the cashier never leaves /sale. Enter starts the next sale. */
export function ReceiptPanel({ sale, tenderedFils, shop, onNewSale }: { sale: Sale; tenderedFils: number | null; shop: ReceiptShop; onNewSale: () => void }) {
  const newSale = useRef<HTMLButtonElement>(null);
  useEffect(() => { newSale.current?.focus(); }, []);
  const change = tenderedFils === null ? null : changeDue(sale.grossFils, tenderedFils);

  return (
    <>
      <aside className="panel cart-panel receipt-panel" aria-label="Sale complete">
        <div className="panel-header"><div><div className="panel-title"><CheckCircle size={18} weight="fill" /> Sale complete</div><div className="panel-subtitle">{sale.invoiceNumber}</div></div></div>
        <div className="checkout-block">
          <div className="summary-line total"><span>Total</span><strong>{formatAED(sale.grossFils)}</strong></div>
          {change && change.ok ? (
            <>
              <div className="summary-line"><span>Cash received</span><strong>{formatAED(tenderedFils ?? 0)}</strong></div>
              <div className="change-due"><span>Change due</span><strong>{formatAED(change.changeFils)}</strong></div>
            </>
          ) : <div className="summary-line"><span>Paid by</span><strong>Card</strong></div>}
          <div className="receipt-actions">
            <button className="button" type="button" onClick={() => printDocument("receipt")}><Printer size={16} weight="bold" />Print 80mm</button>
            <Link className="button" href={`/sales/${sale.id}`}><FilePdf size={16} weight="bold" />Print A4</Link>
            <button ref={newSale} className="button primary" type="button" onClick={onNewSale} aria-keyshortcuts="Enter"><Plus size={16} weight="bold" />New sale</button>
          </div>
        </div>
      </aside>
      {/* Outside the panel: its sticky/fixed position and overflow:hidden would clip the printed receipt. */}
      <ReceiptDocument sale={sale} shop={shop} />
    </>
  );
}
