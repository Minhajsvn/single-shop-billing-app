"use client";

import { useState } from "react";
import { splitVatInclusive } from "@/lib/fiscal/countries";

// A working piece of the till for the home page: tap products, take cash, and the receipt prints with the
// 5% VAT split the app uses. Turning the Wi-Fi off shows a sale still completing and waiting to sync.
// Sample shop and items only; nothing is sent anywhere.

const ITEMS = [
  { id: "karak", name: "Karak Tea", priceFils: 300 },
  { id: "water", name: "Al Ain Water 1.5L", priceFils: 250 },
  { id: "labneh", name: "Labneh 400g", priceFils: 1450 },
  { id: "dates", name: "Medjool Dates 1kg", priceFils: 3200 },
] as const;

type ItemId = (typeof ITEMS)[number]["id"];

const money = (fils: number) => (fils / 100).toFixed(2);

export function LiveTill() {
  const [cart, setCart] = useState<Partial<Record<ItemId, number>>>({ karak: 2, labneh: 1 });
  const [online, setOnline] = useState(true);
  const [waiting, setWaiting] = useState(0);
  const [invoiceNo, setInvoiceNo] = useState(143);
  const [paid, setPaid] = useState(false);

  const lines = ITEMS.filter((item) => (cart[item.id] ?? 0) > 0).map((item) => ({
    ...item,
    qty: cart[item.id] ?? 0,
    totalFils: item.priceFils * (cart[item.id] ?? 0),
  }));
  // VAT is worked out per line, then summed, the way the till stores it.
  const split = lines.reduce(
    (sum, line) => {
      const part = splitVatInclusive(line.totalFils, 500);
      return { net: sum.net + part.netFils, vat: sum.vat + part.vatFils, gross: sum.gross + part.grossFils };
    },
    { net: 0, vat: 0, gross: 0 },
  );

  function add(id: ItemId) {
    if (paid) {
      setPaid(false);
      setInvoiceNo((n) => n + 1);
      setCart({ [id]: 1 });
      return;
    }
    setCart((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
  }

  function pay() {
    if (paid || split.gross === 0) return;
    setPaid(true);
    if (!online) setWaiting((n) => n + 1);
  }

  function toggleNetwork() {
    const next = !online;
    setOnline(next);
    if (next) setWaiting(0); // back online: the queued sales sync
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "F2") {
      event.preventDefault();
      pay();
    }
  }

  const status = online ? "Online · synced" : `Offline · ${waiting} waiting`;

  return (
    <div className="till" data-ui onKeyDown={onKeyDown}>
      <div className="till-bar">
        <span className="till-title">New sale</span>
        <span className={`till-status ${online ? "is-online" : "is-offline"}`} role="status">
          {status}
        </span>
        <button type="button" className="till-wifi" aria-pressed={!online} onClick={toggleNetwork}>
          {online ? "Turn Wi-Fi off" : "Turn Wi-Fi on"}
        </button>
      </div>
      <div className="till-body">
        <div className="till-items" role="group" aria-label="Products">
          {ITEMS.map((item) => (
            <button key={item.id} type="button" className="till-item" onClick={() => add(item.id)}>
              <span>{item.name}</span>
              <span className="till-num">{money(item.priceFils)}</span>
            </button>
          ))}
          <button type="button" className="till-pay" onClick={pay} disabled={paid || split.gross === 0}>
            <span>{paid ? "Paid" : "Cash"}</span>
            <kbd>F2</kbd>
          </button>
        </div>
        <div className={`till-receipt ${paid ? "is-paid" : ""}`} aria-live="polite">
          <p className="rc-shop">Al Noor Grocery</p>
          <p className="rc-small">Al Barsha 1, Dubai</p>
          <p className="rc-small">TRN 100123456700003</p>
          <p className="rc-kind">Simplified tax invoice</p>
          <p className="rc-small">INV-0{invoiceNo}</p>
          <ul className="rc-lines">
            {lines.length === 0 && <li className="rc-empty">Tap a product</li>}
            {lines.map((line) => (
              <li key={line.id}>
                <span>
                  {line.name}
                  {line.qty > 1 && ` ${line.qty} × ${money(line.priceFils)}`}
                </span>
                <span className="till-num">{money(line.totalFils)}</span>
              </li>
            ))}
          </ul>
          <dl className="rc-totals">
            <div><dt>Subtotal</dt><dd className="till-num">{money(split.net)}</dd></div>
            <div className="rc-vat"><dt>VAT 5%</dt><dd className="till-num">{money(split.vat)}</dd></div>
            <div className="rc-total"><dt>Total AED</dt><dd className="till-num">{money(split.gross)}</dd></div>
          </dl>
          <p className="rc-foot">{paid ? (online ? "Paid · Cash · synced" : "Paid · Cash · will sync") : "Thank you."}</p>
        </div>
      </div>
    </div>
  );
}
