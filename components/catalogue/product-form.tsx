"use client";

import { X } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import { parsePriceCell } from "@/lib/catalogue/parse";
import { formatAED, type Product } from "@/lib/domain";
import type { TaxCategory } from "@/lib/fiscal/countries";

export type ProductFormValues = Pick<Product, "name" | "sku" | "barcode" | "priceFils" | "stock" | "lowStockThreshold" | "taxCategory">;

const TAX_OPTIONS: { value: TaxCategory; label: string }[] = [
  { value: "standard", label: "Standard (5%)" },
  { value: "zero", label: "Zero-rated (0%)" },
  { value: "exempt", label: "Exempt" },
];

/** Add and Edit product share this form. Stock is entered once (opening stock); afterwards it changes only through Adjust stock. */
export function ProductForm({ mode, product, barcode, onSubmit, onCancel, onAdjustStock }: {
  mode: "add" | "edit";
  product?: Product;
  barcode?: string;
  /** Returns an error to show, or null when saved. */
  onSubmit: (values: ProductFormValues) => string | null;
  onCancel: () => void;
  onAdjustStock?: () => void;
}) {
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const price = parsePriceCell(String(data.get("price") ?? ""));
    if (!price.ok) return setError(price.reason);
    const stock = mode === "add" ? Number(data.get("stock")) : product?.stock ?? 0;
    const threshold = Number(data.get("threshold"));
    if (!Number.isInteger(stock) || stock < 0 || !Number.isInteger(threshold) || threshold < 0) return setError("Stock and the low-stock threshold must be whole numbers of 0 or more.");
    const barcodeValue = String(data.get("barcode") ?? "").trim();
    setError(onSubmit({
      name: String(data.get("name") ?? "").trim(),
      sku: String(data.get("sku") ?? "").trim().toUpperCase(),
      barcode: barcodeValue || undefined,
      priceFils: price.value,
      stock,
      lowStockThreshold: threshold,
      taxCategory: String(data.get("taxCategory")) as TaxCategory,
    }) ?? "");
  }

  const title = mode === "add" ? "Add product" : "Edit product";
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}>
      <form className="modal" onSubmit={submit} aria-label={title}>
        <div className="modal-header"><div><div className="panel-title">{title}</div><div className="panel-subtitle">Prices are entered inclusive of VAT</div></div><button type="button" className="button icon-only" onClick={onCancel} aria-label="Close"><X size={16} weight="bold" /></button></div>
        <div className="modal-body"><div className="form-grid">
          <div className="field full-span"><label htmlFor="name">Product name</label><input className="input" id="name" name="name" required maxLength={160} defaultValue={product?.name} autoFocus /></div>
          <div className="field"><label htmlFor="sku">SKU</label><input className="input" id="sku" name="sku" required maxLength={100} defaultValue={product?.sku} /></div>
          <div className="field"><label htmlFor="barcode">Barcode</label><input className="input" id="barcode" name="barcode" inputMode="numeric" maxLength={100} defaultValue={product?.barcode ?? barcode} /></div>
          <div className="field"><label htmlFor="price">Price (AED)</label><input className="input" id="price" name="price" inputMode="decimal" required defaultValue={product ? (product.priceFils / 100).toFixed(2) : undefined} placeholder="12.50" /></div>
          {mode === "add" ? (
            <div className="field"><label htmlFor="stock">Opening stock</label><input className="input" id="stock" name="stock" type="number" min="0" step="1" defaultValue="0" required /></div>
          ) : (
            <div className="field"><span className="field-label">Stock</span><div className="stock-readonly"><strong>{product?.stock ?? 0}</strong>{onAdjustStock ? <button type="button" className="button" onClick={onAdjustStock}>Adjust stock</button> : null}</div></div>
          )}
          <div className="field"><label htmlFor="threshold">Low-stock threshold</label><input className="input" id="threshold" name="threshold" type="number" min="0" step="1" defaultValue={product?.lowStockThreshold ?? 5} required /></div>
          <div className="field"><label htmlFor="taxCategory">VAT category</label><select className="select" id="taxCategory" name="taxCategory" defaultValue={product?.taxCategory ?? "standard"}>{TAX_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>Checkout currently charges 5% VAT on every product.</small></div>
          {mode === "edit" && product ? <p className="field-hint full-span">Editing never changes past invoices; they keep the name and price they were sold at ({formatAED(product.priceFils)} now).</p> : null}
        </div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div>
        <div className="modal-footer"><button type="button" className="button" onClick={onCancel}>Cancel</button><button className="button primary" type="submit">Save product</button></div>
      </form>
    </div>
  );
}
