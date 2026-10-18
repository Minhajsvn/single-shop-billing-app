"use client";

import { Printer, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { LABEL_PAGE_SIZE, LabelSheet, type LabelItem, type LabelSize } from "@/components/catalogue/label-sheet";
import { barcodeFor } from "@/lib/catalogue/barcode";
import type { Product } from "@/lib/domain";
import { printDocument } from "@/lib/print";

const SIZE_KEY = "shop-ledger-label-size-v1";
const MAX_COPIES = 999;
const CONFIRM_ABOVE = 500;

function readSize(): LabelSize {
  try {
    return window.localStorage.getItem(SIZE_KEY) === "40x30" ? "40x30" : "50x25";
  } catch {
    return "50x25";
  }
}

/** Choose how many labels per product and the label size, then print on a thermal label printer. */
export function LabelPrintDialog({ products, onClose }: { products: Product[]; onClose: () => void }) {
  // Opened only after a click, never on the server, so the remembered size can be read straight away.
  const [size, setSize] = useState<LabelSize>(readSize);
  const [quantities, setQuantities] = useState<Record<string, number>>(() => Object.fromEntries(products.map((product) => [product.id, products.length === 1 ? 1 : Math.min(MAX_COPIES, Math.max(1, product.stock))])));
  const [printing, setPrinting] = useState(false);
  const codes = useMemo(() => new Map(products.map((product) => [product.id, barcodeFor(product)])), [products]);
  const total = products.reduce((sum, product) => sum + (codes.get(product.id) ? quantities[product.id] ?? 0 : 0), 0);

  // The labels exist in the page only while printing; print once they are mounted.
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener("afterprint", done, { once: true });
    printDocument("labels", { pageSize: LABEL_PAGE_SIZE[size] });
    return () => window.removeEventListener("afterprint", done);
  }, [printing, size]);

  function chooseSize(next: LabelSize) {
    setSize(next);
    try { window.localStorage.setItem(SIZE_KEY, next); } catch { /* remembered size is a convenience only */ }
  }

  function print() {
    if (total > CONFIRM_ABOVE && !window.confirm(`Print ${total.toLocaleString("en-US")} labels? Large print jobs can take a while to prepare.`)) return;
    setPrinting(true);
  }

  const items: LabelItem[] = printing
    ? products.flatMap((product) => {
      const code = codes.get(product.id);
      return code ? [{ product, quantity: quantities[product.id] ?? 0, code }] : [];
    })
    : [];

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <div className="modal" role="dialog" aria-label="Print labels">
        <div className="modal-header">
          <div><div className="panel-title">Print labels</div><div className="panel-subtitle">For a thermal label printer: one label per page.</div></div>
          <button type="button" className="button icon-only" onClick={onClose} aria-label="Close"><X size={16} weight="bold" /></button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label htmlFor="label-size">Label size</label>
            <select className="select" id="label-size" value={size} onChange={(event) => chooseSize(event.target.value as LabelSize)}>
              <option value="50x25">50 × 25 mm</option>
              <option value="40x30">40 × 30 mm</option>
            </select>
            <small>Set the same paper size in the print dialog if your printer asks.</small>
          </div>
          <div className="label-list">
            {products.map((product) => {
              const code = codes.get(product.id);
              return (
                <div className="label-list-row" key={product.id}>
                  <label htmlFor={`copies-${product.id}`}>
                    <strong>{product.name}</strong>
                    {code ? <span>{code.value}</span> : <span className="label-unprintable">No printable barcode: edit its SKU or barcode (letters, digits and simple symbols only).</span>}
                  </label>
                  <input
                    className="input"
                    id={`copies-${product.id}`}
                    type="number"
                    min="0"
                    max={MAX_COPIES}
                    step="1"
                    disabled={!code}
                    value={code ? quantities[product.id] ?? 0 : 0}
                    onChange={(event) => setQuantities({ ...quantities, [product.id]: Math.min(MAX_COPIES, Math.max(0, Math.floor(Number(event.target.value) || 0))) })}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div className="modal-footer">
          <span className="label-total">{total.toLocaleString("en-US")} labels</span>
          <button type="button" className="button" onClick={onClose}>Cancel</button>
          <button type="button" className="button primary" disabled={!total || printing} onClick={print}><Printer size={15} weight="bold" /> {printing ? "Preparing…" : "Print"}</button>
        </div>
      </div>
      {printing ? <LabelSheet items={items} size={size} /> : null}
    </div>
  );
}
