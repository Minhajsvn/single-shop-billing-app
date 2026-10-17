"use client";

import { useEffect, useState } from "react";
import { useShopContext } from "@/lib/demo-store";
import { formatAED, formatDateTime, type Sale } from "@/lib/domain";

export type ReceiptShop = { name: string; trn: string; address: string; phone: string; footer: string };

const SETTINGS_KEY = "shop-ledger-demo-settings-v1";
const defaultShop: ReceiptShop = { name: "Al Noor Corner Shop", trn: "100000000000003", phone: "+971 4 555 0184", address: "Dubai, United Arab Emirates", footer: "Thank you for shopping with us." };

/**
 * The shop identity printed on a sale's documents. An issued invoice uses the supplier details captured with the
 * sale; otherwise hosted shops use the server copy and browser-only stores their localStorage settings.
 */
export function useReceiptShop(sale: Sale | undefined): ReceiptShop {
  const { mode, business } = useShopContext();
  const [savedShop, setSavedShop] = useState(defaultShop);
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
  if (sale?.supplier) return { name: sale.supplier.name, trn: sale.supplier.trn, address: sale.supplier.address, phone: sale.supplier.phone, footer };
  if (business) return { name: business.legalName, trn: business.trn, address: business.address, phone: business.phone, footer };
  return mode === "hosted" ? { name: "", trn: "", address: "", phone: "", footer } : savedShop;
}

/** Saving on one line, in fils (0 when the line was not discounted). */
export function lineSaving(line: Sale["lines"][number]): number {
  return line.listUnitGrossFils ? (line.listUnitGrossFils - line.unitGrossFils) * line.quantity : 0;
}

/** The 80mm receipt. UAE tax invoices must show any discount, so discounted lines show the list price and saving. */
export function ReceiptDocument({ sale, shop }: { sale: Sale; shop: ReceiptShop }) {
  const totalSaving = sale.lines.reduce((sum, line) => sum + lineSaving(line), 0);
  return (
    <article className="receipt-document">
      <header><h1>{shop.name}</h1><p>{shop.address}<br />{shop.phone}<br />TRN {shop.trn}</p><h2>Tax Invoice</h2></header>
      <div className="receipt-meta"><div><span>Invoice</span><strong>{sale.invoiceNumber}</strong></div><div><span>Issued</span><strong>{formatDateTime(sale.createdAt)}</strong></div><div><span>Payment</span><strong>{sale.paymentMethod === "cash" ? "Cash" : "Card"}</strong></div></div>
      <div className="receipt-lines">{sale.lines.map((item) => (
        <div className="receipt-line" key={item.id}>
          <div>
            <strong>{item.name}</strong>
            <span>{item.quantity} × {formatAED(item.unitGrossFils)}</span>
            {item.listUnitGrossFils ? <span>was {formatAED(item.listUnitGrossFils)} · saved {formatAED(lineSaving(item))}</span> : null}
          </div>
          <strong>{formatAED(item.grossFils)}</strong>
        </div>
      ))}</div>
      <div className="receipt-totals">
        {totalSaving > 0 ? <div><span>You saved</span><strong>{formatAED(totalSaving)}</strong></div> : null}
        <div><span>Net</span><strong>{formatAED(sale.netFils)}</strong></div>
        <div><span>VAT 5%</span><strong>{formatAED(sale.vatFils)}</strong></div>
        <div className="receipt-grand"><span>Total</span><strong>{formatAED(sale.grossFils)}</strong></div>
      </div>
      <footer>{shop.footer}</footer>
    </article>
  );
}
