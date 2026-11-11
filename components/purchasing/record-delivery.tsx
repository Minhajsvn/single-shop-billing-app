"use client";

import { ArrowLeft, MagnifyingGlass, Plus, Trash, WarningCircle } from "@/components/icons";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { useProductCosts } from "@/components/catalogue/use-product-costs";
import { PurchasingGate } from "@/components/purchasing/purchasing-gate";
import { SupplierForm } from "@/components/purchasing/supplier-form";
import { useDemoProducts } from "@/hooks/use-demo-products";
import { refreshSnapshot } from "@/lib/demo-store";
import { formatAED, type Product } from "@/lib/domain";
import { parseCostInput } from "@/lib/profit/math";
import { listSuppliers, recordReceipt } from "@/lib/purchasing/client";
import { costPreview, defaultInvoiceDate, draftTotals, mergeLines, validateDraft, type DraftLine } from "@/lib/purchasing/draft";
import type { ReceiptDetail, Supplier } from "@/lib/purchasing/types";

const asInput = (fils: number | null | undefined) => (fils === null || fils === undefined ? "" : (fils / 100).toFixed(2));

/** Stage 2D: record one delivery from a supplier invoice. Online only; the draft lives in memory on this page. */
export function RecordDelivery() {
  return <>
    <div className="page-heading"><div><Link className="back-link" href="/purchases"><ArrowLeft size={14} weight="bold" /> Purchases</Link><h1 className="page-title">Record delivery</h1><p className="page-copy">Enter the supplier invoice once: stock goes up and each product&apos;s average cost updates.</p></div></div>
    <PurchasingGate offlineText="Recording a delivery needs a connection"><DeliveryForm /></PurchasingGate>
  </>;
}

function DeliveryForm() {
  const { products } = useDemoProducts();
  const productCosts = useProductCosts(true);
  const [receiptId, setReceiptId] = useState(() => crypto.randomUUID());
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [invoice, setInvoice] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => defaultInvoiceDate(new Date()));
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [costText, setCostText] = useState<Record<string, string>>({});
  const [vatText, setVatText] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<ReceiptDetail | null>(null);

  useEffect(() => {
    let live = true;
    void listSuppliers().then((result) => {
      if (!live) return;
      if (result.ok) setSuppliers(result.suppliers.filter((supplier) => !supplier.archived));
      else setError(result.error);
    });
    return () => { live = false; };
  }, []);

  const byId = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const term = query.trim().toLowerCase();
  const matches = term ? products.filter((product) => product.active && [product.name, product.sku, product.barcode].some((value) => value?.toLowerCase().includes(term))).slice(0, 8) : [];

  // Lines carry the typed cost; an empty or invalid cost is held as -1 so validation can name it.
  const priced = lines.map((line) => {
    const parsed = parseCostInput(costText[line.productId] ?? "");
    return { ...line, unitCostFils: parsed.ok && parsed.value !== null ? parsed.value : -1 };
  });
  const vatParsed = vatText === null ? null : parseCostInput(vatText);
  const totals = draftTotals(priced.map((line) => ({ ...line, unitCostFils: Math.max(line.unitCostFils, 0) })), vatParsed && vatParsed.ok ? vatParsed.value ?? 0 : null);

  function add(product: Product) {
    const known = productCosts.costs?.get(product.id);
    setLines((current) => mergeLines(current, { productId: product.id, unitCostFils: known ?? 0 }));
    setCostText((current) => (product.id in current ? current : { ...current, [product.id]: asInput(known) }));
    setQuery("");
    setError("");
  }

  function scan(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const code = query.trim().toLowerCase();
    if (!code) return;
    const exact = products.find((product) => product.active && (product.barcode?.toLowerCase() === code || product.sku.toLowerCase() === code));
    if (exact) return add(exact);
    if (matches.length === 1) return add(matches[0]);
    setError(matches.length ? "More than one product matches; pick one below." : `No product with code ${query.trim()}.`);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missing = priced.find((line) => line.unitCostFils < 0);
    if (missing) return setError(`Enter a unit cost for ${byId.get(missing.productId)?.name ?? "each product"}.`);
    if (vatParsed && !vatParsed.ok) return setError("VAT must be an amount like 3.63.");
    const problem = validateDraft({ supplierId: supplierId || null, lines: priced, vatFils: totals.vatFils });
    if (problem) return setError(problem);
    setBusy(true);
    const result = await recordReceipt({
      id: receiptId,
      supplierId,
      ...(invoice.trim() ? { supplierInvoice: invoice.trim() } : {}),
      invoiceDate,
      vatFils: totals.vatFils,
      lines: priced.map(({ productId, quantity, unitCostFils }) => ({ productId, quantity, unitCostFils })),
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setSaved(result.receipt);
    void refreshSnapshot();
    productCosts.reload();
  }

  function another() {
    setReceiptId(crypto.randomUUID());
    setLines([]);
    setCostText({});
    setVatText(null);
    setInvoice("");
    setSaved(null);
    setError("");
  }

  if (saved) {
    return <section className="panel">
      <div className="panel-header"><div><div className="panel-title">Delivery saved</div><div className="panel-subtitle">{saved.supplierName} · {saved.invoiceDate}{saved.supplierInvoice ? ` · ${saved.supplierInvoice}` : ""} · {formatAED(saved.grossFils)}</div></div></div>
      <div className="table-wrap stack-table"><table><thead><tr><th>Product</th><th className="numeric">Qty</th><th className="numeric">Unit cost</th><th className="numeric">Cost now</th></tr></thead>
        <tbody>{saved.lines.map((line) => <tr key={line.productId}><td data-label="Product">{line.productName}</td><td data-label="Qty" className="numeric">{line.quantity}</td><td data-label="Unit cost" className="numeric">{formatAED(line.unitCostFils)}</td><td data-label="Cost now" className="numeric">{line.costBeforeFils === null ? "" : `${formatAED(line.costBeforeFils)} → `}{formatAED(line.costAfterFils)}</td></tr>)}</tbody></table></div>
      <div className="panel-body row-actions"><button type="button" className="button primary" onClick={another}><Plus size={15} weight="bold" /> Record another</button><Link className="button" href={`/purchases/${saved.id}`}>View delivery</Link></div>
    </section>;
  }

  return <form className="delivery-form" onSubmit={save}>
    <section className="panel"><div className="panel-body form-grid">
      <div className="field"><label htmlFor="delivery-supplier">Supplier</label>
        <div className="inline-field"><select className="select" id="delivery-supplier" value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
          <option value="">Choose a supplier</option>
          {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select><button type="button" className="button" onClick={() => setAddingSupplier(true)}><Plus size={14} weight="bold" /> New supplier</button></div></div>
      <div className="field"><label htmlFor="delivery-invoice">Supplier invoice no. (optional)</label><input className="input" id="delivery-invoice" maxLength={40} value={invoice} onChange={(event) => setInvoice(event.target.value)} /></div>
      <div className="field"><label htmlFor="delivery-date">Invoice date</label><input className="input" id="delivery-date" type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} required /></div>
    </div></section>

    <section className="panel">
      <div className="panel-body">
        <div className="search"><MagnifyingGlass size={16} weight="bold" /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={scan} placeholder="Scan a barcode or search name, SKU" aria-label="Add a product" autoFocus /></div>
        {matches.length ? <ul className="delivery-matches">{matches.map((product) => <li key={product.id}><button type="button" className="button" onClick={() => add(product)}>{product.name} <span className="product-meta">{product.sku} · stock {product.stock}</span></button></li>)}</ul> : null}
      </div>
      {lines.length ? (
        <div className="table-wrap stack-table"><table><thead><tr><th>Product</th><th className="numeric">Qty</th><th className="numeric">Unit cost excl. VAT</th><th className="numeric">Line</th><th><span className="sr-only">Remove</span></th></tr></thead>
          <tbody>{priced.map((line) => {
            const product = byId.get(line.productId);
            const cost = productCosts.costs?.get(line.productId) ?? null;
            const after = line.unitCostFils >= 0 && line.quantity >= 1 ? costPreview(product?.stock ?? 0, cost, line.quantity, line.unitCostFils) : null;
            return <tr key={line.productId}>
              <td data-label="Product"><div className="product-name">{product?.name ?? "Unknown product"}</div><div className="product-meta">{product?.sku} · stock {product?.stock ?? 0}{after !== null && after !== cost ? ` · Cost ${cost === null ? "—" : formatAED(cost)} → ${formatAED(after)}` : ""}</div></td>
              <td data-label="Qty" className="numeric"><input className="input qty-input" type="number" min={1} max={100000} step={1} value={line.quantity} aria-label={`Quantity of ${product?.name}`} onChange={(event) => setLines((current) => current.map((item) => item.productId === line.productId ? { ...item, quantity: Number(event.target.value) } : item))} /></td>
              <td data-label="Unit cost" className="numeric"><input className="input qty-input" inputMode="decimal" value={costText[line.productId] ?? ""} aria-label={`Unit cost of ${product?.name}`} onChange={(event) => setCostText((current) => ({ ...current, [line.productId]: event.target.value }))} /></td>
              <td data-label="Line" className="numeric">{line.unitCostFils >= 0 ? formatAED(line.quantity * line.unitCostFils) : "—"}</td>
              <td className="numeric"><button type="button" className="button icon-only" aria-label={`Remove ${product?.name}`} onClick={() => setLines((current) => current.filter((item) => item.productId !== line.productId))}><Trash size={14} weight="bold" /></button></td>
            </tr>;
          })}</tbody></table></div>
      ) : <div className="panel-body"><p className="field-hint">Scan or search to add the products on the supplier&apos;s invoice.</p></div>}
    </section>

    <section className="panel"><div className="panel-body delivery-totals">
      <div><span>Net</span><strong>{formatAED(totals.netFils)}</strong></div>
      <div className="field"><label htmlFor="delivery-vat">VAT (AED)</label><input className="input qty-input" id="delivery-vat" inputMode="decimal" value={vatText ?? asInput(totals.vatFils)} onChange={(event) => setVatText(event.target.value)} /><small>5% by default; match the supplier&apos;s invoice.</small></div>
      <div><span>Total</span><strong>{formatAED(totals.grossFils)}</strong></div>
    </div>
    {error ? <div className="notice error-notice" role="alert"><WarningCircle size={18} weight="fill" /><span>{error}</span></div> : null}
    <div className="panel-body row-actions"><Link className="button" href="/purchases">Cancel</Link><button className="button primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save delivery"}</button></div></section>
    {addingSupplier ? <SupplierForm onCancel={() => setAddingSupplier(false)} onSaved={(supplier) => { setSuppliers((current) => [...current, supplier].sort((a, b) => a.name.localeCompare(b.name))); setSupplierId(supplier.id); setAddingSupplier(false); }} /> : null}
  </form>;
}
