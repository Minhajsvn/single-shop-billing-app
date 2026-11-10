"use client";

import { X } from "@/components/icons";
import { useState, type FormEvent } from "react";
import { liveCategories } from "@/lib/catalogue/categories";
import { parsePriceCell } from "@/lib/catalogue/parse";
import { formatAED, type Category, type Product } from "@/lib/domain";
import type { TaxCategory } from "@/lib/fiscal/countries";
import { isBelowCost, marginPct, parseCostInput, priceExVatFils } from "@/lib/profit/math";

export type ProductFormValues = Pick<Product, "name" | "sku" | "barcode" | "priceFils" | "stock" | "lowStockThreshold" | "taxCategory" | "categoryId">;

/**
 * Stage 2C: cost on the form. Shown to an owner or manager on Pro; only the owner edits it. `initialFils` is
 * undefined while the costs are still loading.
 */
export type CostView = { canSee: boolean; canEdit: boolean; online: boolean; initialFils: number | null | undefined };

const TAX_OPTIONS: { value: TaxCategory; label: string }[] = [
  { value: "standard", label: "Standard (5%)" },
  { value: "zero", label: "Zero-rated (0%)" },
  { value: "exempt", label: "Exempt" },
];

const asInput = (fils: number | null | undefined) => (fils === null || fils === undefined ? "" : (fils / 100).toFixed(2));

/** Add and Edit product share this form. Stock is entered once (opening stock); afterwards it changes only through Adjust stock. */
export function ProductForm({ mode, product, barcode, categories, cost, onSubmit, onSaveCost, onDone, onCancel, onAdjustStock }: {
  mode: "add" | "edit";
  product?: Product;
  barcode?: string;
  categories: Category[];
  cost?: CostView;
  /** Saves the product; returns an error to show, or the saved product's id. */
  onSubmit: (values: ProductFormValues) => { error: string } | { productId: string };
  /** Sends a changed cost online; returns an error to show, or null. */
  onSaveCost?: (productId: string, costFils: number | null) => Promise<string | null>;
  /** Everything saved. */
  onDone: () => void;
  onCancel: () => void;
  onAdjustStock?: () => void;
}) {
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [priceText, setPriceText] = useState(product ? (product.priceFils / 100).toFixed(2) : "");
  const [costText, setCostText] = useState<string | null>(null);
  const live = liveCategories(categories);
  // A product in an archived category keeps it until the owner picks another.
  const current = product?.categoryId ? categories.find((category) => category.id === product.categoryId) : undefined;
  const options = current?.archived ? [...live, current] : live;

  const showCost = Boolean(cost?.canSee);
  const costLoading = showCost && cost?.initialFils === undefined;
  const costEditable = Boolean(cost?.canEdit && cost.online && !costLoading);
  const costValue = costText ?? asInput(cost?.initialFils);
  const parsedCost = parseCostInput(costValue);
  const parsedPrice = parsePriceCell(priceText);
  const taxCategory = product?.taxCategory ?? "standard";
  const margin = parsedPrice.ok && parsedCost.ok && parsedCost.value !== null ? marginPct(priceExVatFils(parsedPrice.value, taxCategory), parsedCost.value) : null;
  const below = parsedPrice.ok && parsedCost.ok && isBelowCost({ priceFils: parsedPrice.value, taxCategory }, parsedCost.value);

  async function saveCost(productId: string) {
    if (!showCost || !costEditable || costText === null || !onSaveCost) return onDone();
    if (!parsedCost.ok) return setError(parsedCost.reason);
    if (parsedCost.value === (cost?.initialFils ?? null)) return onDone();
    setBusy(true);
    const problem = await onSaveCost(productId, parsedCost.value);
    setBusy(false);
    if (problem) setError(problem);
    else onDone();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savedId) return saveCost(savedId);
    const data = new FormData(event.currentTarget);
    const price = parsePriceCell(String(data.get("price") ?? ""));
    if (!price.ok) return setError(price.reason);
    if (costEditable && costText !== null && !parsedCost.ok) return setError(parsedCost.reason);
    const stock = mode === "add" ? Number(data.get("stock")) : product?.stock ?? 0;
    const threshold = Number(data.get("threshold"));
    if (!Number.isInteger(stock) || stock < 0 || !Number.isInteger(threshold) || threshold < 0) return setError("Stock and the low-stock threshold must be whole numbers of 0 or more.");
    const barcodeValue = String(data.get("barcode") ?? "").trim();
    const categoryValue = String(data.get("categoryId") ?? "");
    const result = onSubmit({
      name: String(data.get("name") ?? "").trim(),
      sku: String(data.get("sku") ?? "").trim().toUpperCase(),
      barcode: barcodeValue || undefined,
      priceFils: price.value,
      stock,
      lowStockThreshold: threshold,
      taxCategory: String(data.get("taxCategory")) as TaxCategory,
      categoryId: categoryValue || null,
    });
    if ("error" in result) return setError(result.error);
    setError("");
    // The product is saved (or queued); from here on the dialog only retries the cost.
    setSavedId(result.productId);
    await saveCost(result.productId);
  }

  const title = mode === "add" ? "Add product" : "Edit product";
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}>
      <form className="modal" onSubmit={submit} aria-label={title}>
        <div className="modal-header"><div><div className="panel-title">{title}</div><div className="panel-subtitle">Prices are entered inclusive of VAT</div></div><button type="button" className="button icon-only" onClick={onCancel} aria-label="Close"><X size={16} weight="bold" /></button></div>
        <div className="modal-body">{savedId ? (
          <div className="form-grid">
            <p className="field-hint full-span">The product is saved. Only its cost is left.</p>
            <div className="field"><label htmlFor="cost">Cost (excl. VAT)</label><input className="input" id="cost" inputMode="decimal" value={costValue} onChange={(event) => setCostText(event.target.value)} autoFocus /></div>
          </div>
        ) : <div className="form-grid">
          <div className="field full-span"><label htmlFor="name">Product name</label><input className="input" id="name" name="name" required maxLength={160} defaultValue={product?.name} autoFocus /></div>
          <div className="field"><label htmlFor="sku">SKU</label><input className="input" id="sku" name="sku" required maxLength={100} defaultValue={product?.sku} /></div>
          <div className="field"><label htmlFor="barcode">Barcode</label><input className="input" id="barcode" name="barcode" inputMode="numeric" maxLength={100} defaultValue={product?.barcode ?? barcode} /></div>
          <div className="field"><label htmlFor="price">Price (AED)</label><input className="input" id="price" name="price" inputMode="decimal" required value={priceText} onChange={(event) => setPriceText(event.target.value)} placeholder="12.50" />
            {showCost && margin !== null ? <small className={below ? "margin-readout below" : "margin-readout"}>Margin {margin.toFixed(1)}%{below ? <span className="badge red">Below cost</span> : null}</small> : null}
          </div>
          {mode === "add" ? (
            <div className="field"><label htmlFor="stock">Opening stock</label><input className="input" id="stock" name="stock" type="number" min="0" step="1" defaultValue="0" required /></div>
          ) : (
            <div className="field"><span className="field-label">Stock</span><div className="stock-readonly"><strong>{product?.stock ?? 0}</strong>{onAdjustStock ? <button type="button" className="button" onClick={onAdjustStock}>Adjust stock</button> : null}</div></div>
          )}
          <div className="field"><label htmlFor="categoryId">Category</label><select className="select" id="categoryId" name="categoryId" defaultValue={product?.categoryId ?? ""}><option value="">No category</option>{options.map((category) => <option key={category.id} value={category.id}>{category.archived ? `${category.name} (archived)` : category.name}</option>)}</select></div>
          {showCost ? (
            <div className="field"><label htmlFor="cost">Cost (excl. VAT)</label>
              <input className="input" id="cost" inputMode="decimal" placeholder={costLoading ? "Loading…" : "e.g. 9.75"} value={costValue} readOnly={!cost?.canEdit} disabled={!costEditable && Boolean(cost?.canEdit)} onChange={(event) => setCostText(event.target.value)} />
              {!cost?.online ? <small>Cost needs a connection</small> : !cost.canEdit ? <small>Only the owner changes costs.</small> : null}
            </div>
          ) : null}
          <div className="field"><label htmlFor="threshold">Low-stock threshold</label><input className="input" id="threshold" name="threshold" type="number" min="0" step="1" defaultValue={product?.lowStockThreshold ?? 5} required /></div>
          <div className="field"><label htmlFor="taxCategory">VAT category</label><select className="select" id="taxCategory" name="taxCategory" defaultValue={product?.taxCategory ?? "standard"}>{TAX_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>Checkout currently charges 5% VAT on every product.</small></div>
          {mode === "edit" && product ? <p className="field-hint full-span">Editing never changes past invoices; they keep the name and price they were sold at ({formatAED(product.priceFils)} now).</p> : null}
        </div>}{error ? <p className="form-error" role="alert">{error}</p> : null}</div>
        <div className="modal-footer">
          {savedId ? <><button type="button" className="button" onClick={onDone}>Close</button><button className="button primary" type="submit" disabled={busy}>Retry cost</button></>
            : <><button type="button" className="button" onClick={onCancel}>Cancel</button><button className="button primary" type="submit" disabled={busy}>Save product</button></>}
        </div>
      </form>
    </div>
  );
}
