"use client";

import { Archive, ArrowCounterClockwise, Barcode, DownloadSimple, FileArrowUp, MagnifyingGlass, PencilSimple, Plus, WarningCircle, X } from "@phosphor-icons/react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ImportDialog } from "@/components/catalogue/import-dialog";
import { LabelPrintDialog } from "@/components/catalogue/label-print-dialog";
import { ProductForm, type ProductFormValues } from "@/components/catalogue/product-form";
import { useDemoProducts } from "@/hooks/use-demo-products";
import { productsToCsv } from "@/lib/catalogue/csv";
import { formatAED, type Product } from "@/lib/domain";
import { dubaiSupplyDate } from "@/lib/invoice-numbers";

type Dialog =
  | { kind: "new"; barcode?: string }
  | { kind: "edit"; product: Product }
  | { kind: "adjust"; product: Product }
  | { kind: "import" }
  | { kind: "labels"; productIds: string[] }
  | null;
type StatusFilter = "active" | "archived";

function downloadCsv(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function InventoryWorkspace() {
  const { products, addProduct, updateProduct, setProductActive, adjustStock, syncProblems } = useDemoProducts();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState("");
  const [pageError, setPageError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // The POS links unknown scans to /inventory?barcode=…: open "Add product" once with that barcode filled in.
  useEffect(() => {
    const barcode = new URLSearchParams(window.location.search).get("barcode")?.trim();
    if (!barcode) return;
    // Clear the query only once the dialog opens, so a re-run of this effect (React dev double-invoke) still sees it.
    const timer = window.setTimeout(() => {
      setDialog({ kind: "new", barcode });
      window.history.replaceState(null, "", window.location.pathname);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return products.filter((product) => product.active === (status === "active") && (!term || [product.name, product.sku, product.barcode].some((value) => value?.toLowerCase().includes(term))));
  }, [products, query, status]);

  function saveNew(values: ProductFormValues) {
    const result = addProduct(values);
    if (!result.ok) return result.error;
    setDialog(null);
    return null;
  }

  function saveEdit(product: Product, values: ProductFormValues) {
    const result = updateProduct(product.id, { name: values.name, sku: values.sku, barcode: values.barcode, priceFils: values.priceFils, lowStockThreshold: values.lowStockThreshold, taxCategory: values.taxCategory });
    if (!result.ok) return result.error;
    setDialog(null);
    return null;
  }

  function archive(product: Product) {
    if (!window.confirm(`Archive ${product.name}? Archived products are hidden from the till. Past invoices are kept.`)) return;
    const result = setProductActive(product.id, false);
    setPageError(result.ok ? "" : result.error);
  }

  function restore(product: Product) {
    const result = setProductActive(product.id, true);
    setPageError(result.ok ? "" : result.error);
  }

  function exportCatalogue() {
    downloadCsv(`products-${dubaiSupplyDate(new Date())}.csv`, productsToCsv(products));
  }

  function submitAdjustment(event: FormEvent<HTMLFormElement>, product: Product) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const direction = String(data.get("direction"));
    const quantity = Number(data.get("quantity"));
    const delta = direction === "in" ? quantity : -quantity;
    if (!adjustStock(product.id, delta, String(data.get("reason") ?? "").trim())) {
      setError("This adjustment would make available stock negative.");
      return;
    }
    setError("");
    setDialog(null);
  }

  function closeDialog() {
    setError("");
    setDialog(null);
  }

  const attention = products.filter((product) => syncProblems.has(product.id)).length;
  const selectedVisible = filtered.filter((product) => selected.has(product.id));
  const allSelected = filtered.length > 0 && selectedVisible.length === filtered.length;

  function toggle(productId: string) {
    const next = new Set(selected);
    if (next.has(productId)) next.delete(productId);
    else next.add(productId);
    setSelected(next);
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(filtered.map((product) => product.id)));
  }

  return (
    <>
      <div className="page-heading">
        <div><div className="eyebrow">Catalog and stock</div><h1 className="page-title">Inventory</h1><p className="page-copy">Maintain sellable items and keep every stock change traceable.</p></div>
        <div className="page-actions">
          <button className="button" onClick={exportCatalogue} disabled={!products.length}><DownloadSimple size={15} weight="bold" /> Export</button>
          <button className="button" onClick={() => setDialog({ kind: "import" })}><FileArrowUp size={15} weight="bold" /> Import</button>
          <button className="button primary" onClick={() => setDialog({ kind: "new" })}><Plus size={15} weight="bold" /> Add product</button>
        </div>
      </div>

      {attention ? <div className="notice error-notice" role="status"><WarningCircle size={18} weight="fill" /><span><strong>{attention} {attention === 1 ? "product needs" : "products need"} attention.</strong> The server did not accept {attention === 1 ? "it" : "them"}; edit the marked products to fix the problem shown.</span></div> : null}
      {pageError ? <div className="notice error-notice" role="alert"><WarningCircle size={18} weight="fill" /><span>{pageError}</span></div> : null}

      <section className="panel">
        <div className="panel-body">
          <div className="toolbar">
            <div className="search"><MagnifyingGlass size={16} weight="bold" /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, SKU, or barcode" aria-label="Search inventory" /></div>
            <div className="segmented status-filter" role="radiogroup" aria-label="Show products">
              <button type="button" role="radio" aria-checked={status === "active"} className={`button ${status === "active" ? "primary" : ""}`} onClick={() => setStatus("active")}>Active</button>
              <button type="button" role="radio" aria-checked={status === "archived"} className={`button ${status === "archived" ? "primary" : ""}`} onClick={() => setStatus("archived")}>Archived</button>
            </div>
            <span className="button" aria-label="Product count">{filtered.length} products</span>
            <button type="button" className="button" disabled={!selectedVisible.length} onClick={() => setDialog({ kind: "labels", productIds: selectedVisible.map((product) => product.id) })}><Barcode size={15} weight="bold" /> Print labels ({selectedVisible.length})</button>
          </div>
        </div>
        {filtered.length ? (
          <div className="table-wrap"><table><thead><tr><th className="select-column"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all shown products" /></th><th>Product</th><th>Status</th><th className="numeric">Stock</th><th className="numeric">Price incl. VAT</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{filtered.map((product) => {
            const low = product.stock <= product.lowStockThreshold;
            const problem = syncProblems.get(product.id);
            return (
              <tr key={product.id}>
                <td className="select-column"><input type="checkbox" checked={selected.has(product.id)} onChange={() => toggle(product.id)} aria-label={`Select ${product.name}`} /></td>
                <td><div className="product-name">{product.name}</div><div className="product-meta">{product.sku}{product.barcode ? ` · ${product.barcode}` : ""}{product.taxCategory !== "standard" ? ` · ${product.taxCategory === "zero" ? "Zero-rated" : "Exempt"}` : ""}</div></td>
                <td>
                  {product.active ? <span className={`badge ${low ? "red" : "green"}`}>{low ? "Low stock" : "In stock"}</span> : <span className="badge yellow">Archived</span>}
                  {problem ? <div className="sync-problem"><span className="badge red" title={problem}>Not saved to the server</span><small>{problem}</small></div> : null}
                </td>
                <td className="numeric">{product.stock}</td>
                <td className="numeric">{formatAED(product.priceFils)}</td>
                <td className="numeric"><div className="row-actions">
                  <button className="button" onClick={() => setDialog({ kind: "edit", product })} aria-label={`Edit ${product.name}`}><PencilSimple size={14} weight="bold" /> Edit</button>
                  <button className="button" onClick={() => setDialog({ kind: "labels", productIds: [product.id] })} aria-label={`Print labels for ${product.name}`}><Barcode size={14} weight="bold" /> Labels</button>
                  {product.active ? (
                    <>
                      <button className="button" onClick={() => setDialog({ kind: "adjust", product })}>Adjust stock</button>
                      <button className="button" onClick={() => archive(product)} aria-label={`Archive ${product.name}`}><Archive size={14} weight="bold" /> Archive</button>
                    </>
                  ) : <button className="button" onClick={() => restore(product)} aria-label={`Restore ${product.name}`}><ArrowCounterClockwise size={14} weight="bold" /> Restore</button>}
                </div></td>
              </tr>
            );
          })}</tbody></table></div>
        ) : status === "archived"
          ? <div className="empty"><Archive size={28} weight="duotone" /><h3>No archived products</h3><p>Archived products are hidden from the till and listed here.</p></div>
          : <div className="empty"><Archive size={28} weight="duotone" /><h3>No matching products</h3><p>Change the search, import a spreadsheet, or add a new product to the catalog.</p><button className="button primary" onClick={() => setDialog({ kind: "new" })}>Add product</button></div>}
      </section>

      {dialog?.kind === "new" && <ProductForm mode="add" barcode={dialog.barcode} onSubmit={saveNew} onCancel={closeDialog} />}

      {dialog?.kind === "edit" && (
        <ProductForm
          mode="edit"
          product={products.find((product) => product.id === dialog.product.id) ?? dialog.product}
          onSubmit={(values) => saveEdit(dialog.product, values)}
          onCancel={closeDialog}
          onAdjustStock={() => setDialog({ kind: "adjust", product: dialog.product })}
        />
      )}

      {dialog?.kind === "import" && <ImportDialog onClose={closeDialog} onPrintLabels={(productIds) => setDialog({ kind: "labels", productIds })} />}

      {dialog?.kind === "labels" && <LabelPrintDialog products={products.filter((product) => dialog.productIds.includes(product.id))} onClose={closeDialog} />}

      {dialog?.kind === "adjust" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
          <form className="modal" onSubmit={(event) => submitAdjustment(event, dialog.product)} aria-label="Adjust stock">
            <div className="modal-header"><div><div className="panel-title">Adjust stock</div><div className="panel-subtitle">{dialog.product.name} · {dialog.product.stock} currently available</div></div><button type="button" className="button icon-only" onClick={closeDialog} aria-label="Close"><X size={16} weight="bold" /></button></div>
            <div className="modal-body"><div className="form-grid">
              <div className="field"><label htmlFor="direction">Movement</label><select className="select" id="direction" name="direction"><option value="in">Stock in</option><option value="out">Stock out</option></select></div>
              <div className="field"><label htmlFor="quantity">Quantity</label><input className="input" id="quantity" name="quantity" type="number" min="1" step="1" required autoFocus /></div>
              <div className="field full-span"><label htmlFor="reason">Reason</label><textarea className="textarea" id="reason" name="reason" placeholder="Delivery received, damaged item, counting correction…" required /></div>
            </div>{error && <p className="form-error">{error}</p>}</div>
            <div className="modal-footer"><button type="button" className="button" onClick={closeDialog}>Cancel</button><button className="button primary" type="submit">Record movement</button></div>
          </form>
        </div>
      )}
    </>
  );
}
