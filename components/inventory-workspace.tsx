"use client";

import { Archive, MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import { FormEvent, useMemo, useState } from "react";
import { useDemoProducts } from "@/hooks/use-demo-products";
import { formatAED, type Product } from "@/lib/domain";

type Dialog = { kind: "new" } | { kind: "adjust"; product: Product } | null;

export function InventoryWorkspace() {
  const { products, addProduct, adjustStock } = useDemoProducts();
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return products.filter((product) => !term || [product.name, product.sku, product.barcode].some((value) => value?.toLowerCase().includes(term)));
  }, [products, query]);

  function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const sku = String(data.get("sku") ?? "").trim().toUpperCase();
    const barcode = String(data.get("barcode") ?? "").trim();
    if (products.some((product) => product.sku === sku || (barcode && product.barcode === barcode))) {
      setError("SKU and barcode must be unique.");
      return;
    }
    addProduct({
      name: String(data.get("name") ?? "").trim(),
      sku,
      barcode: barcode || undefined,
      priceFils: Math.round(Number(data.get("price")) * 100),
      stock: Number(data.get("stock")),
      lowStockThreshold: Number(data.get("threshold")),
    });
    setError("");
    setDialog(null);
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

  return (
    <>
      <div className="page-heading">
        <div><div className="eyebrow">Catalog and stock</div><h1 className="page-title">Inventory</h1><p className="page-copy">Maintain sellable items and keep every stock change traceable.</p></div>
        <button className="button primary" onClick={() => setDialog({ kind: "new" })}><Plus size={15} weight="bold" /> Add product</button>
      </div>

      <section className="panel">
        <div className="panel-body">
          <div className="toolbar">
            <div className="search"><MagnifyingGlass size={16} weight="bold" /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, SKU, or barcode" aria-label="Search inventory" /></div>
            <span className="button" aria-label="Product count">{filtered.length} products</span>
          </div>
        </div>
        {filtered.length ? (
          <div className="table-wrap"><table><thead><tr><th>Product</th><th>Status</th><th className="numeric">Stock</th><th className="numeric">Price incl. VAT</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{filtered.map((product) => {
            const low = product.stock <= product.lowStockThreshold;
            return <tr key={product.id}><td><div className="product-name">{product.name}</div><div className="product-meta">{product.sku}{product.barcode ? ` · ${product.barcode}` : ""}</div></td><td><span className={`badge ${low ? "red" : "green"}`}>{low ? "Low stock" : "In stock"}</span></td><td className="numeric">{product.stock}</td><td className="numeric">{formatAED(product.priceFils)}</td><td className="numeric"><button className="button" onClick={() => setDialog({ kind: "adjust", product })}>Adjust stock</button></td></tr>;
          })}</tbody></table></div>
        ) : <div className="empty"><Archive size={28} weight="duotone" /><h3>No matching products</h3><p>Change the search or add a new product to the catalog.</p><button className="button primary" onClick={() => setDialog({ kind: "new" })}>Add product</button></div>}
      </section>

      {dialog?.kind === "new" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
          <form className="modal" onSubmit={submitProduct} aria-label="Add product">
            <div className="modal-header"><div><div className="panel-title">Add product</div><div className="panel-subtitle">Prices are entered inclusive of 5% VAT</div></div><button type="button" className="button icon-only" onClick={closeDialog} aria-label="Close"><X size={16} weight="bold" /></button></div>
            <div className="modal-body"><div className="form-grid">
              <div className="field full-span"><label htmlFor="name">Product name</label><input className="input" id="name" name="name" required autoFocus /></div>
              <div className="field"><label htmlFor="sku">SKU</label><input className="input" id="sku" name="sku" required /></div>
              <div className="field"><label htmlFor="barcode">Barcode</label><input className="input" id="barcode" name="barcode" inputMode="numeric" /></div>
              <div className="field"><label htmlFor="price">Price (AED)</label><input className="input" id="price" name="price" type="number" min="0.01" step="0.01" required /></div>
              <div className="field"><label htmlFor="stock">Opening stock</label><input className="input" id="stock" name="stock" type="number" min="0" step="1" defaultValue="0" required /></div>
              <div className="field"><label htmlFor="threshold">Low-stock threshold</label><input className="input" id="threshold" name="threshold" type="number" min="0" step="1" defaultValue="5" required /></div>
            </div>{error && <p className="form-error">{error}</p>}</div>
            <div className="modal-footer"><button type="button" className="button" onClick={closeDialog}>Cancel</button><button className="button primary" type="submit">Save product</button></div>
          </form>
        </div>
      )}

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
