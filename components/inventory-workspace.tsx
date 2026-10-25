"use client";

import { Archive, ArrowCounterClockwise, Barcode, DownloadSimple, FileArrowUp, MagnifyingGlass, PencilSimple, Plus, WarningCircle, X } from "@phosphor-icons/react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { READ_ONLY_REASON, useEntitlement } from "@/components/billing/use-entitlement";
import { ImportDialog } from "@/components/catalogue/import-dialog";
import { LabelPrintDialog } from "@/components/catalogue/label-print-dialog";
import { ProductForm, type ProductFormValues } from "@/components/catalogue/product-form";
import { EmptyState, Pager, SummaryStrip } from "@/components/ui/list-parts";
import { useListParams } from "@/components/ui/use-list-params";
import { isOwnerView } from "@/lib/access/cashier";
import { useShopContext } from "@/lib/demo-store";
import { paginate } from "@/lib/lists/paging";
import { useDemoProducts } from "@/hooks/use-demo-products";
import { productsToCsv } from "@/lib/catalogue/csv";
import { formatAED, type Product } from "@/lib/domain";
import { dubaiSupplyDate } from "@/lib/invoice-numbers";
import { requestConfirm } from "@/lib/ui/confirm-store";
import { toast } from "@/lib/ui/toast-store";

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
  const [params, setParams] = useListParams({ q: "", status: "active", page: "1" });
  const query = params.q;
  const status: StatusFilter = params.status === "archived" ? "archived" : "active";
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState("");
  const [pageError, setPageError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { canWrite: planAllowsWrites } = useEntitlement();
  // A cashier sees products and stock read-only: no add, edit, import, stock adjustment or archive (owner decision 7).
  const manage = isOwnerView(useShopContext().role);
  const canWrite = planAllowsWrites && manage;
  const readOnlyTitle = planAllowsWrites ? undefined : READ_ONLY_REASON;

  // The POS links unknown scans to /inventory?barcode=…: open "Add product" once with that barcode filled in.
  useEffect(() => {
    const barcode = new URLSearchParams(window.location.search).get("barcode")?.trim();
    if (!barcode || !manage) return;
    // Clear the query only once the dialog opens, so a re-run of this effect (React dev double-invoke) still sees it.
    const timer = window.setTimeout(() => {
      setDialog({ kind: "new", barcode });
      window.history.replaceState(null, "", window.location.pathname);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [manage]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return products.filter((product) => product.active === (status === "active") && (!term || [product.name, product.sku, product.barcode].some((value) => value?.toLowerCase().includes(term))));
  }, [products, query, status]);
  // Pages of 50; archiving the last row of the last page steps back a page (paginate clamps).
  const paged = paginate(filtered, Number(params.page) || 1);
  const lowStock = products.filter((product) => product.active && product.stock <= product.lowStockThreshold).length;

  function saveNew(values: ProductFormValues) {
    const result = addProduct(values);
    if (!result.ok) return result.error;
    setDialog(null);
    toast("Product saved");
    return null;
  }

  function saveEdit(product: Product, values: ProductFormValues) {
    const result = updateProduct(product.id, { name: values.name, sku: values.sku, barcode: values.barcode, priceFils: values.priceFils, lowStockThreshold: values.lowStockThreshold, taxCategory: values.taxCategory });
    if (!result.ok) return result.error;
    setDialog(null);
    toast("Product saved");
    return null;
  }

  async function archive(product: Product) {
    if (!(await requestConfirm({ title: `Archive ${product.name}?`, body: "Archived products are hidden from the till. Past invoices are kept.", confirmLabel: "Archive" }))) return;
    const result = setProductActive(product.id, false);
    setPageError(result.ok ? "" : result.error);
    if (result.ok) toast("Product archived");
  }

  function restore(product: Product) {
    const result = setProductActive(product.id, true);
    setPageError(result.ok ? "" : result.error);
    if (result.ok) toast("Product restored");
  }

  function exportCatalogue() {
    downloadCsv(`products-${dubaiSupplyDate(new Date())}.csv`, productsToCsv(products));
    toast("Export ready");
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
  // A Set keeps "print labels for these 5,000 imported products" linear.
  const labelProducts = useMemo(() => {
    if (dialog?.kind !== "labels") return [];
    const ids = new Set(dialog.productIds);
    return products.filter((product) => ids.has(product.id));
  }, [dialog, products]);
  const selectedVisible = filtered.filter((product) => selected.has(product.id));
  const allSelected = paged.items.length > 0 && paged.items.every((product) => selected.has(product.id));

  function toggle(productId: string) {
    const next = new Set(selected);
    if (next.has(productId)) next.delete(productId);
    else next.add(productId);
    setSelected(next);
  }

  function toggleAll() {
    const next = new Set(selected);
    for (const product of paged.items) {
      if (allSelected) next.delete(product.id);
      else next.add(product.id);
    }
    setSelected(next);
  }

  return (
    <>
      <div className="page-heading">
        <div><div className="eyebrow">Catalog and stock</div><h1 className="page-title">Inventory</h1><p className="page-copy">Maintain sellable items and keep every stock change traceable.</p></div>
        <div className="page-actions">
          <button className="button" onClick={exportCatalogue} disabled={!products.length}><DownloadSimple size={15} weight="bold" /> Export</button>
          {manage ? <>
            <button className="button" onClick={() => setDialog({ kind: "import" })} disabled={!canWrite} title={readOnlyTitle}><FileArrowUp size={15} weight="bold" /> Import</button>
            <button className="button primary" onClick={() => setDialog({ kind: "new" })} disabled={!canWrite} title={readOnlyTitle}><Plus size={15} weight="bold" /> Add product</button>
          </> : null}
        </div>
      </div>

      {attention ? <div className="notice error-notice" role="status"><WarningCircle size={18} weight="fill" /><span><strong>{attention} {attention === 1 ? "product needs" : "products need"} attention.</strong> The server did not accept {attention === 1 ? "it" : "them"}; edit the marked products to fix the problem shown.</span></div> : null}
      {!manage ? <p className="read-only-hint" role="note">The shop owner manages products and stock. Export, labels and search work here.</p>
        : canWrite ? null : <p className="read-only-hint" role="note">{READ_ONLY_REASON} Export, labels and search still work.</p>}
      {pageError ? <div className="notice error-notice" role="alert"><WarningCircle size={18} weight="fill" /><span>{pageError}</span></div> : null}

      <SummaryStrip label="Inventory summary" items={[{ label: "Products", value: products.filter((product) => product.active).length.toLocaleString("en-US") }, { label: "Low stock", value: lowStock.toLocaleString("en-US") }, { label: "Archived", value: products.filter((product) => !product.active).length.toLocaleString("en-US") }]} />
      <section className="panel">
        <div className="panel-body">
          <div className="toolbar">
            <div className="search"><MagnifyingGlass size={16} weight="bold" /><input className="input" value={query} onChange={(event) => setParams({ q: event.target.value, page: "1" })} placeholder="Search name, SKU, or barcode" aria-label="Search inventory" /></div>
            <div className="segmented status-filter" role="radiogroup" aria-label="Show products">
              <button type="button" role="radio" aria-checked={status === "active"} className={`button ${status === "active" ? "primary" : ""}`} onClick={() => setParams({ status: "active", page: "1" })}>Active</button>
              <button type="button" role="radio" aria-checked={status === "archived"} className={`button ${status === "archived" ? "primary" : ""}`} onClick={() => setParams({ status: "archived", page: "1" })}>Archived</button>
            </div>
            <button type="button" className="button" disabled={!selectedVisible.length} onClick={() => setDialog({ kind: "labels", productIds: selectedVisible.map((product) => product.id) })}><Barcode size={15} weight="bold" /> Print labels ({selectedVisible.length})</button>
          </div>
        </div>
        {paged.items.length ? (
          <div className="table-wrap"><table><thead><tr><th className="select-column"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all products on this page" /></th><th>Product</th><th>Status</th><th className="numeric">Stock</th><th className="numeric">Price incl. VAT</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{paged.items.map((product) => {
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
                  {manage ? <button className="button" onClick={() => setDialog({ kind: "edit", product })} disabled={!canWrite} title={readOnlyTitle} aria-label={`Edit ${product.name}`}><PencilSimple size={14} weight="bold" /> Edit</button> : null}
                  <button className="button" onClick={() => setDialog({ kind: "labels", productIds: [product.id] })} aria-label={`Print labels for ${product.name}`}><Barcode size={14} weight="bold" /> Labels</button>
                  {!manage ? null : product.active ? (
                    <>
                      <button className="button" onClick={() => setDialog({ kind: "adjust", product })} disabled={!canWrite} title={readOnlyTitle}>Adjust stock</button>
                      <button className="button" onClick={() => archive(product)} disabled={!canWrite} title={readOnlyTitle} aria-label={`Archive ${product.name}`}><Archive size={14} weight="bold" /> Archive</button>
                    </>
                  ) : <button className="button" onClick={() => restore(product)} disabled={!canWrite} title={readOnlyTitle} aria-label={`Restore ${product.name}`}><ArrowCounterClockwise size={14} weight="bold" /> Restore</button>}
                </div></td>
              </tr>
            );
          })}</tbody></table></div>
        ) : status === "archived"
          ? <EmptyState icon={<Archive size={28} weight="duotone" />} title="No archived products" hint="Archived products are hidden from the till and listed here." />
          : products.length
            ? <EmptyState icon={<Archive size={28} weight="duotone" />} title={`No products match "${query}"`} hint="Try a name, SKU or barcode." />
            : <EmptyState icon={<Archive size={28} weight="duotone" />} title="No products yet" hint={manage ? "Import a spreadsheet or add your first product." : "The shop owner adds the products."} action={canWrite ? <button className="button primary" onClick={() => setDialog({ kind: "new" })}>Add product</button> : undefined} />}
        <Pager {...paged} onPage={(next) => setParams({ page: String(next) })} />
      </section>

      {dialog?.kind === "new" && canWrite && <ProductForm mode="add" barcode={dialog.barcode} onSubmit={saveNew} onCancel={closeDialog} />}

      {dialog?.kind === "edit" && canWrite && (
        <ProductForm
          mode="edit"
          product={products.find((product) => product.id === dialog.product.id) ?? dialog.product}
          onSubmit={(values) => saveEdit(dialog.product, values)}
          onCancel={closeDialog}
          onAdjustStock={() => setDialog({ kind: "adjust", product: dialog.product })}
        />
      )}

      {dialog?.kind === "import" && canWrite && <ImportDialog onClose={closeDialog} onPrintLabels={(productIds) => setDialog({ kind: "labels", productIds })} />}

      {dialog?.kind === "labels" && <LabelPrintDialog products={labelProducts} onClose={closeDialog} />}

      {dialog?.kind === "adjust" && canWrite && (
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
