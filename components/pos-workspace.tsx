"use client";

import { CreditCard, IdentificationCard, MagnifyingGlass, Minus, Money, Plus, ShoppingCart, Tag, Trash, User, X } from "@phosphor-icons/react";
import Link from "next/link";
import { FormEvent, KeyboardEvent, useMemo, useRef, useState } from "react";
import { HeldCarts } from "@/components/pos/held-carts";
import { LineDiscountDialog } from "@/components/pos/line-discount-dialog";
import { PaymentDialog } from "@/components/pos/payment-dialog";
import { ReceiptPanel } from "@/components/pos/receipt-panel";
import { useReceiptShop } from "@/components/receipt-document";
import type { HeldCart } from "@/lib/checkout/held-carts";
import { findByCode } from "@/lib/checkout/lookup";
import { staleRegister } from "@/lib/checkout/register-status";
import { cartTotals } from "@/lib/checkout/pricing";
import { completeSale, type CheckoutLine, useDemoStore, useShopContext } from "@/lib/demo-store";
import { formatAED, type Product, type Sale } from "@/lib/domain";

type CartItem = CheckoutLine & { key: string };

export function PosWorkspace() {
  const store = useDemoStore();
  const { device } = useShopContext();
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerId, setCustomerId] = useState<string>();
  const [error, setError] = useState("");
  const [payment, setPayment] = useState<{ method: "cash" | "card"; error?: string } | null>(null);
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [discountFor, setDiscountFor] = useState<string | null>(null);
  const [completed, setCompleted] = useState<{ sale: Sale; tenderedFils: number | null } | null>(null);
  const receiptShop = useReceiptShop(completed?.sale);
  const discountLine = discountFor ? cart.find((item) => item.key === discountFor) : undefined;
  const searchInput = useRef<HTMLInputElement>(null);

  const availableProducts = useMemo(() => {
    const term = query.trim().toLowerCase();
    return store.products.filter((product) => product.active && (!term || [product.name, product.sku, product.barcode].some((value) => value?.toLowerCase().includes(term))));
  }, [query, store.products]);

  const totals = useMemo(() => cartTotals(cart), [cart]);

  function addProduct(product: Product) {
    setError("");
    setCart((current) => {
      const existing = current.find((item) => item.productId === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) return current;
        return current.map((item) => item.key === existing.key ? { ...item, quantity: item.quantity + 1 } : item);
      }
      if (product.stock < 1) return current;
      return [...current, { key: product.id, productId: product.id, name: product.name, sku: product.sku, quantity: 1, unitGrossFils: product.priceFils }];
    });
  }

  /** Scanner input arrives as typed characters plus Enter: an exact barcode/SKU match is added straight to the cart. */
  function scan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = query.trim();
    if (!code) return;
    const product = findByCode(store.products, code);
    if (product) {
      const inCart = cart.find((item) => item.productId === product.id)?.quantity ?? 0;
      setUnknownCode(null);
      setQuery("");
      if (inCart >= product.stock) {
        setError(`Only ${product.stock} of ${product.name} in stock.`);
        beep(false);
        return;
      }
      addProduct(product);
      beep(true);
      return;
    }
    // Unknown codes never touch the cart; offer to create the product instead of failing silently.
    if (/^[0-9A-Za-z-]{4,}$/.test(code)) {
      setUnknownCode(code);
      beep(false);
    }
  }

  /** Keyboard shortcuts (F2/F3, scanning) only work with focus inside the POS, so dialogs hand focus back to search. */
  function closeDialog(close: (value: null) => void) {
    close(null);
    window.setTimeout(() => searchInput.current?.focus(), 0);
  }

  function resumeHeld(held: HeldCart, notices: string[]) {
    setCart(held.lines.map((line) => ({ ...line, key: line.productId ?? crypto.randomUUID() })));
    setCustomerId(held.customerId);
    setError(notices.join(" "));
  }

  function applyDiscount(key: string, unitGrossFils: number) {
    setCart((current) => current.map((line) => line.key === key ? { ...line, listUnitGrossFils: line.listUnitGrossFils ?? line.unitGrossFils, unitGrossFils } : line));
    closeDialog(setDiscountFor);
  }

  function removeDiscount(key: string) {
    setCart((current) => current.map((line) => {
      if (line.key !== key || !line.listUnitGrossFils) return line;
      const { listUnitGrossFils, ...rest } = line;
      return { ...rest, unitGrossFils: listUnitGrossFils };
    }));
    closeDialog(setDiscountFor);
  }

  function changeQuantity(item: CartItem, delta: number) {
    setCart((current) => current.flatMap((line) => {
      if (line.key !== item.key) return [line];
      const nextQuantity = line.quantity + delta;
      if (nextQuantity < 1) return [];
      const product = line.productId ? store.products.find((candidate) => candidate.id === line.productId) : undefined;
      if (product && nextQuantity > product.stock) return [line];
      return [{ ...line, quantity: nextQuantity }];
    }));
  }

  function addCustomLine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const unitGrossFils = Math.round(Number(data.get("price")) * 100);
    if (!name || !Number.isFinite(unitGrossFils) || unitGrossFils < 1) return;
    setCart((current) => [...current, { key: crypto.randomUUID(), name, quantity: 1, unitGrossFils }]);
    setCustomOpen(false);
  }

  function pay(method: "cash" | "card") {
    setError("");
    setPayment({ method });
  }

  function completePayment(tenderedFils: number | null) {
    if (!payment) return;
    const lines = cart.map(({ productId, name, sku, quantity, unitGrossFils, listUnitGrossFils }) => ({ productId, name, sku, quantity, unitGrossFils, listUnitGrossFils }));
    const result = completeSale(lines, payment.method, customerId);
    if (!result.ok) {
      setPayment({ ...payment, error: result.error });
      return;
    }
    // Stay on /sale: the receipt panel replaces the cart until the cashier starts the next sale.
    setPayment(null);
    setCart([]);
    setCustomerId(undefined);
    setCompleted({ sale: result.sale, tenderedFils });
  }

  function startNewSale() {
    setCompleted(null);
    searchInput.current?.focus();
  }

  const registerOpen = store.register?.status === "open";
  // A register left open from an earlier Dubai day must be closed before any more sales (end-of-day integrity).
  const stale = staleRegister(store.register, new Date());
  const canSell = registerOpen && !stale.stale;
  const selectedCustomer = store.customers.find((customer) => customer.id === customerId);

  function handleShortcut(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const isTyping = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
    if (event.key === "/" && !isTyping) {
      event.preventDefault();
      searchInput.current?.focus();
    }
    if (event.key === "Escape") {
      setCustomOpen(false);
      setCustomerOpen(false);
    }
    if (!customOpen && !customerOpen && !payment && !completed && canSell && cart.length && event.key === "F2") {
      event.preventDefault();
      pay("cash");
    }
    if (!customOpen && !customerOpen && !payment && !completed && canSell && cart.length && event.key === "F3") {
      event.preventDefault();
      pay("card");
    }
  }

  return (
    <div onKeyDown={handleShortcut}>
      <div className="page-heading pos-heading"><div><div className="eyebrow">Point of sale</div><h1 className="page-title">New sale</h1><p className="page-copy">Search or scan products, confirm the cart, then record Cash or Card.</p></div><div className="pos-status"><span className={`badge ${registerOpen ? "green" : "red"}`}>{registerOpen ? "Register open" : "Register closed"}</span><span className="keyboard-hint"><kbd>/</kbd> Search <kbd>F2</kbd> Cash <kbd>F3</kbd> Card</span></div></div>

      {!registerOpen && <div className="notice error-notice"><CashRegisterNotice /> <div><strong>Checkout is locked.</strong> Open the register before accepting a payment.</div></div>}
      {stale.stale && <div className="notice error-notice" role="alert"><CashRegisterNotice /> <div><strong>The register opened on {stale.openedOn} is still open.</strong> Close it on the <Link href="/register">Register page</Link> before selling.</div></div>}

      <div className="pos-layout">
        <section className="panel catalog-panel">
          <div className="panel-body"><div className="toolbar"><form className="search" onSubmit={scan} role="search"><MagnifyingGlass size={17} weight="bold" /><input ref={searchInput} className="input" value={query} onChange={(event) => { setQuery(event.target.value); setUnknownCode(null); }} placeholder="Search name, SKU, or scan barcode" autoFocus aria-label="Search products" aria-keyshortcuts="/" /></form><button className="button" onClick={() => setCustomOpen(true)}><Plus size={15} weight="bold" /> Custom item</button></div></div>
          {unknownCode ? <div className="notice error-notice scan-notice" role="alert"><span>No product with code <strong>{unknownCode}</strong>.</span><Link className="button" href={`/inventory?barcode=${encodeURIComponent(unknownCode)}`}><Plus size={15} weight="bold" /> Add product</Link></div> : null}
          <div className="product-grid">{availableProducts.map((product) => {
            const inCart = cart.find((item) => item.productId === product.id)?.quantity ?? 0;
            const soldOut = product.stock <= inCart;
            return <button className="product-card" key={product.id} onClick={() => addProduct(product)} disabled={soldOut}><div><span className={`badge ${product.stock <= product.lowStockThreshold ? "red" : "green"}`}>{soldOut ? "Unavailable" : `${product.stock - inCart} available`}</span><h3>{product.name}</h3><p>{product.sku}</p></div><strong>{formatAED(product.priceFils)}</strong></button>;
          })}</div>
          {!availableProducts.length && <div className="empty"><MagnifyingGlass size={28} weight="duotone" /><h3>No products found</h3><p>Try a different name, SKU, or barcode.</p></div>}
        </section>

        {completed ? <ReceiptPanel sale={completed.sale} tenderedFils={completed.tenderedFils} shop={receiptShop} onNewSale={startNewSale} /> : <aside className="panel cart-panel">
          <div className="panel-header"><div><div className="panel-title">Current cart</div><div className="panel-subtitle">{cart.reduce((sum, item) => sum + item.quantity, 0)} items</div></div><HeldCarts deviceId={device?.id ?? null} products={store.products} canHold={cart.length > 0} cartIsEmpty={!cart.length} onHold={() => ({ customerId, lines: cart.map(({ productId, name, sku, quantity, unitGrossFils, listUnitGrossFils }) => ({ productId, name, sku, quantity, unitGrossFils, listUnitGrossFils })) })} onHeld={() => { setCart([]); setCustomerId(undefined); }} onResume={resumeHeld} />{cart.length > 0 && <button className="button" onClick={() => setCart([])}>Clear</button>}</div>
          <div className="cart-lines" aria-live="polite">{cart.length ? cart.map((item) => <div className="cart-line" key={item.key}><div className="cart-line-top"><div><div className="product-name">{item.name}</div><div className="product-meta">{item.sku ?? "Custom non-stock item"}</div>{item.listUnitGrossFils ? <div className="product-meta discount-meta"><s>{formatAED(item.listUnitGrossFils)}</s> {formatAED(item.unitGrossFils)} each · −{formatAED((item.listUnitGrossFils - item.unitGrossFils) * item.quantity)}</div> : null}</div><button className="cart-remove" onClick={() => setCart((current) => current.filter((line) => line.key !== item.key))} aria-label={`Remove ${item.name}`}><Trash size={15} weight="bold" /></button></div><div className="cart-line-bottom"><div className="quantity-stepper"><button onClick={() => changeQuantity(item, -1)} aria-label={`Decrease ${item.name}`}><Minus size={13} weight="bold" /></button><span>{item.quantity}</span><button onClick={() => changeQuantity(item, 1)} aria-label={`Increase ${item.name}`}><Plus size={13} weight="bold" /></button></div><button className="button discount-button" type="button" onClick={() => setDiscountFor(item.key)} aria-label={`Discount ${item.name}`}><Tag size={14} weight="bold" />{item.listUnitGrossFils ? "Edit" : "Discount"}</button><strong>{formatAED(item.unitGrossFils * item.quantity)}</strong></div></div>) : <div className="cart-empty"><ShoppingCart size={30} weight="duotone" /><p>Add a product to begin the sale.</p></div>}</div>

          <div className="checkout-block">
            <button className="customer-selector" onClick={() => setCustomerOpen(true)}><span className="customer-selector-icon">{selectedCustomer ? <IdentificationCard size={17} weight="fill" /> : <User size={17} weight="bold" />}</span><span><small>Invoice customer</small><strong>{selectedCustomer?.name ?? "Walk-in customer"}</strong></span><span className="customer-selector-action">Change</span></button>
            {totals.discountFils > 0 ? <div className="summary-line"><span>Discount</span><strong>−{formatAED(totals.discountFils)}</strong></div> : null}
            <div className="summary-line"><span>Net</span><strong>{formatAED(totals.netFils)}</strong></div>
            <div className="summary-line"><span>VAT 5%</span><strong>{formatAED(totals.vatFils)}</strong></div>
            <div className="summary-line total"><span>Total</span><strong>{formatAED(totals.grossFils)}</strong></div>
            {error && <p className="form-error checkout-error" role="alert">{error}</p>}
            <div className="payment-grid"><button className="payment-button cash" disabled={!canSell || !cart.length} onClick={() => pay("cash")} aria-keyshortcuts="F2"><Money size={21} weight="fill" /><span>Cash · F2</span><small>Record drawer payment</small></button><button className="payment-button card" disabled={!canSell || !cart.length} onClick={() => pay("card")} aria-keyshortcuts="F3"><CreditCard size={21} weight="fill" /><span>Card · F3</span><small>External terminal paid</small></button></div>
          </div>
        </aside>}
      </div>

      {discountLine && <LineDiscountDialog line={discountLine} onApply={(unit) => applyDiscount(discountLine.key, unit)} onRemove={() => removeDiscount(discountLine.key)} onCancel={() => closeDialog(setDiscountFor)} />}
      {payment && <PaymentDialog method={payment.method} totalFils={totals.grossFils} error={payment.error} onCancel={() => closeDialog(setPayment)} onComplete={completePayment} />}
      {customOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCustomOpen(false); }}><form className="modal" onSubmit={addCustomLine}><div className="modal-header"><div><div className="panel-title">Custom item</div><div className="panel-subtitle">This line will not change inventory.</div></div><button type="button" className="button icon-only" onClick={() => setCustomOpen(false)} aria-label="Close"><X size={16} weight="bold" /></button></div><div className="modal-body"><div className="form-grid"><div className="field full-span"><label htmlFor="customName">Description</label><input className="input" id="customName" name="name" required autoFocus /></div><div className="field"><label htmlFor="customPrice">VAT-inclusive price (AED)</label><input className="input" id="customPrice" name="price" type="number" min="0.01" step="0.01" required /></div></div></div><div className="modal-footer"><button type="button" className="button" onClick={() => setCustomOpen(false)}>Cancel</button><button className="button primary" type="submit">Add to cart</button></div></form></div>}
      {customerOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCustomerOpen(false); }}><div className="modal customer-picker"><div className="modal-header"><div><div className="panel-title">Choose invoice customer</div><div className="panel-subtitle">Business details are copied onto this invoice only.</div></div><button type="button" className="button icon-only" onClick={() => setCustomerOpen(false)} aria-label="Close"><X size={16} weight="bold" /></button></div><div className="customer-pick-list"><button className={`customer-pick ${!customerId ? "selected" : ""}`} onClick={() => { setCustomerId(undefined); setCustomerOpen(false); }}><span className="customer-avatar"><User size={16} weight="bold" /></span><span><strong>Walk-in customer</strong><small>Simplified tax invoice</small></span></button>{store.customers.map((customer) => <button className={`customer-pick ${customerId === customer.id ? "selected" : ""}`} key={customer.id} onClick={() => { setCustomerId(customer.id); setCustomerOpen(false); }}><span className="customer-avatar">{customer.name.slice(0, 2).toUpperCase()}</span><span><strong>{customer.name}</strong><small>{customer.trn ? `TRN ${customer.trn}` : customer.phone}</small></span></button>)}</div><div className="modal-footer"><Link className="button" href="/customers">Manage customers</Link></div></div></div>}
    </div>
  );
}

function beep(ok: boolean) {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    oscillator.frequency.value = ok ? 880 : 220;
    oscillator.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + (ok ? 0.08 : 0.2));
    oscillator.onended = () => void context.close();
  } catch {
    // Audio unavailable (autoplay policy or no device): the visual notice still shows.
  }
}

function CashRegisterNotice() {
  return <ShoppingCart size={18} weight="fill" />;
}
