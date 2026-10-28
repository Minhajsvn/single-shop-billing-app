"use client";

import { ClockCounterClockwise, PauseCircle, Trash, X } from "@/components/icons";
import { useEffect, useState } from "react";
import { MAX_HELD_CARTS, heldCartsKey, holdCart, resumeCart, type HeldCart } from "@/lib/checkout/held-carts";
import { cartTotals, formatItemCount } from "@/lib/checkout/pricing";
import { formatAED, formatTime, type Product } from "@/lib/domain";
import { requestConfirm } from "@/lib/ui/confirm-store";
import { toast } from "@/lib/ui/toast-store";

function readHeld(key: string): HeldCart[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(value) ? value as HeldCart[] : [];
  } catch {
    return [];
  }
}

function writeHeld(key: string, list: HeldCart[]) {
  try { window.localStorage.setItem(key, JSON.stringify(list)); } catch { /* storage unavailable: holding is a convenience only */ }
}

/** Park a cart without the Held UI (e.g. before leaving /sale), so it can be resumed on return. */
export function parkCart(deviceId: string | null, cart: Omit<HeldCart, "id" | "heldAt">): { ok: true } | { ok: false; error: string } {
  const key = heldCartsKey(deviceId);
  const result = holdCart(readHeld(key), cart, crypto.randomUUID(), new Date());
  if (!result.ok) return result;
  writeHeld(key, result.list);
  return { ok: true };
}

type Props = {
  deviceId: string | null;
  products: Product[];
  canHold: boolean;
  cartIsEmpty: boolean;
  /** Returns the current cart to hold; the parent clears its cart when onHeld fires. */
  onHold: () => Omit<HeldCart, "id" | "heldAt">;
  onHeld: () => void;
  onResume: (cart: HeldCart, notices: string[]) => void;
};

/** Park a sale on this till (e.g. a customer fetching one more item) and pick it up again later. */
export function HeldCarts({ deviceId, products, canHold, cartIsEmpty, onHold, onHeld, onResume }: Props) {
  const key = heldCartsKey(deviceId);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<HeldCart[]>([]);
  const [message, setMessage] = useState("");
  // Load after mount so server and first client render agree (held sales live only in this browser).
  useEffect(() => {
    const timer = window.setTimeout(() => setList(readHeld(key)), 0);
    return () => window.clearTimeout(timer);
  }, [key]);

  function save(next: HeldCart[]) {
    setList(next);
    writeHeld(key, next);
  }

  function hold() {
    const result = holdCart(readHeld(key), onHold(), crypto.randomUUID(), new Date());
    if (!result.ok) return setMessage(result.error);
    save(result.list);
    setMessage("");
    onHeld();
    toast("Sale held");
  }

  async function resume(id: string) {
    let current = readHeld(key);
    if (!cartIsEmpty) {
      if (!(await requestConfirm({ title: "Hold the current sale first?", body: "The sale in the cart is held so you can resume this one. Cancel keeps you working on the current sale.", confirmLabel: "Hold and resume" }))) return;
      current = readHeld(key);
      const parked = holdCart(current, onHold(), crypto.randomUUID(), new Date());
      if (!parked.ok) return setMessage(parked.error);
      current = parked.list;
      onHeld();
    }
    const result = resumeCart(current, id, products);
    if (!result.ok) return setMessage(result.error);
    save(result.list);
    setOpen(false);
    onResume(result.cart, result.notices);
    toast("Sale resumed");
  }

  async function discard(id: string) {
    if (!(await requestConfirm({ title: "Discard this held sale?", body: "It has not been charged. This cannot be undone.", confirmLabel: "Discard", destructive: true }))) return;
    save(readHeld(key).filter((cart) => cart.id !== id));
  }

  return (
    <div className="held-carts">
      <button className="button" type="button" onClick={hold} disabled={!canHold}><PauseCircle size={16} weight="bold" />Hold</button>
      <button className="button" type="button" onClick={() => { setList(readHeld(key)); setOpen(true); }} disabled={!list.length}><ClockCounterClockwise size={16} weight="bold" />Held ({list.length})</button>
      {message ? <p className="form-error" role="alert">{message}</p> : null}
      {open ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
          <div className="modal" role="dialog" aria-label="Held sales">
            <div className="modal-header">
              <div><div className="panel-title">Held sales</div><div className="panel-subtitle">Up to {MAX_HELD_CARTS} on this till. Not charged until completed.</div></div>
              <button type="button" className="button icon-only" onClick={() => setOpen(false)} aria-label="Close"><X size={16} weight="bold" /></button>
            </div>
            <div className="modal-body held-list">
              {list.map((cart) => (
                <div className="held-row" key={cart.id}>
                  <div><strong>{formatAED(cartTotals(cart.lines).grossFils)}</strong><span>{formatItemCount(cart.lines)} · held {formatTime(cart.heldAt)}</span></div>
                  <button className="button primary" type="button" onClick={() => resume(cart.id)}>Resume</button>
                  <button className="button icon-only" type="button" onClick={() => discard(cart.id)} aria-label="Discard held sale"><Trash size={15} weight="bold" /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
