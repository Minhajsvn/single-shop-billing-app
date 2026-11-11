"use client";

import { X } from "@/components/icons";
import { useMemo, useState, type FormEvent } from "react";
import { liveCategories } from "@/lib/catalogue/categories";
import { useDemoStore } from "@/lib/demo-store";
import { parseCostInput } from "@/lib/profit/math";
import { describePromotion } from "@/lib/promotions/describe";
import { savePromotion } from "@/lib/promotions/client";
import type { Promotion, PromotionKind, PromotionTarget } from "@/lib/promotions/types";
import { uaeBusinessDate } from "@/lib/reporting";

const KINDS: { value: PromotionKind; label: string }[] = [
  { value: "percent_off", label: "% off" },
  { value: "amount_off", label: "AED off each" },
  { value: "multi_buy_free", label: "Buy N get M free" },
  { value: "multi_buy_price", label: "N for AED P" },
  { value: "basket_percent", label: "% off the whole bill" },
];
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const money = (fils: number | null) => (fils === null ? "" : (fils / 100).toFixed(2));

/** Stage 2E: add or edit a promotion. Saving needs a connection; the server checks every rule again. */
export function PromotionForm({ promotion, onSaved, onCancel }: { promotion?: Promotion; onSaved: () => void; onCancel: () => void }) {
  const store = useDemoStore();
  const products = useMemo(() => store.products.filter((product) => product.active).sort((a, b) => a.name.localeCompare(b.name)), [store.products]);
  const categories = liveCategories(store.categories ?? []);
  const [kind, setKind] = useState<PromotionKind>(promotion?.kind ?? "percent_off");
  const [name, setName] = useState(promotion?.name ?? "");
  const [targetType, setTargetType] = useState<PromotionTarget>(promotion?.targetType ?? "category");
  const [targetId, setTargetId] = useState(promotion?.targetId ?? "");
  const [percent, setPercent] = useState(promotion?.percent?.toString() ?? "");
  const [amount, setAmount] = useState(money(promotion?.amountFils ?? null));
  const [buyQty, setBuyQty] = useState(promotion?.buyQty?.toString() ?? "2");
  const [getQty, setGetQty] = useState(promotion?.getQty?.toString() ?? "1");
  const [bundle, setBundle] = useState(money(promotion?.bundlePriceFils ?? null));
  const [minBasket, setMinBasket] = useState(money(promotion?.minBasketFils ?? null));
  const [startsOn, setStartsOn] = useState(promotion?.startsOn ?? uaeBusinessDate(new Date()));
  const [endsOn, setEndsOn] = useState(promotion?.endsOn ?? "");
  const [days, setDays] = useState<number[]>(promotion?.days ?? []);
  const [fromTime, setFromTime] = useState(promotion?.fromTime ?? "");
  const [toTime, setToTime] = useState(promotion?.toTime ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const basket = kind === "basket_percent";
  const effectiveTarget: PromotionTarget = basket ? "all" : targetType;
  const fils = (text: string) => {
    const parsed = parseCostInput(text);
    return parsed.ok ? parsed.value : null;
  };
  const draft: Promotion = {
    id: promotion?.id ?? "", name: name.trim(), kind, targetType: effectiveTarget, targetId: effectiveTarget === "all" ? null : targetId || null,
    percent: kind === "percent_off" || basket ? (percent.trim() ? Number(percent) : null) : null,
    amountFils: kind === "amount_off" ? fils(amount) : null,
    buyQty: kind === "multi_buy_free" || kind === "multi_buy_price" ? Number(buyQty) || null : null,
    getQty: kind === "multi_buy_free" ? Number(getQty) || null : null,
    bundlePriceFils: kind === "multi_buy_price" ? fils(bundle) : null,
    minBasketFils: basket ? fils(minBasket) ?? 0 : null,
    startsOn, endsOn: endsOn || null, days: days.length ? [...days].sort((a, b) => a - b) : null,
    fromTime: fromTime || null, toTime: toTime || null,
    active: promotion?.active ?? true, archived: promotion?.archived ?? false, createdAt: promotion?.createdAt ?? "",
  };
  const targetName = effectiveTarget === "product" ? products.find((product) => product.id === targetId)?.name ?? "a product"
    : effectiveTarget === "category" ? categories.find((category) => category.id === targetId)?.name ?? "a category" : "";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name) return setError("Give the promotion a name customers will see on the receipt.");
    if (effectiveTarget !== "all" && !draft.targetId) return setError("Choose what the promotion applies to.");
    if (Boolean(fromTime) !== Boolean(toTime)) return setError("Give both a start and an end time, or neither.");
    setBusy(true);
    const result = await savePromotion({ ...draft, id: promotion?.id ?? crypto.randomUUID() });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    onSaved();
  }

  const title = promotion ? "Edit promotion" : "New promotion";
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}>
      <form className="modal promotion-form" onSubmit={submit} aria-label={title}>
        <div className="modal-header"><div><div className="panel-title">{title}</div><div className="panel-subtitle">Applied by every till automatically</div></div><button type="button" className="button icon-only" onClick={onCancel} aria-label="Close"><X size={16} weight="bold" /></button></div>
        <div className="modal-body"><div className="form-grid">
          <div className="field full-span"><label htmlFor="promo-name">Name on the receipt</label><input className="input" id="promo-name" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} placeholder="Buy 2 get 1" autoFocus /></div>
          <div className="field"><label htmlFor="promo-kind">Kind</label><select className="select" id="promo-kind" value={kind} onChange={(event) => setKind(event.target.value as PromotionKind)}>{KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
          {basket ? <div className="field"><span className="field-label">Applies to</span><p className="field-hint">The whole bill</p></div> : (
            <div className="field"><label htmlFor="promo-target">Applies to</label>
              <select className="select" id="promo-target" value={targetType} onChange={(event) => { setTargetType(event.target.value as PromotionTarget); setTargetId(""); }}>
                <option value="category">A category</option><option value="product">A product</option><option value="all">Everything</option>
              </select>
              {targetType === "category" ? <select className="select" aria-label="Category" value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Choose a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select> : null}
              {targetType === "product" ? <select className="select" aria-label="Product" value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Choose a product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select> : null}
            </div>
          )}
          {kind === "percent_off" || basket ? <div className="field"><label htmlFor="promo-percent">Percent off</label><input className="input" id="promo-percent" inputMode="decimal" value={percent} onChange={(event) => setPercent(event.target.value)} placeholder="10" /></div> : null}
          {kind === "amount_off" ? <div className="field"><label htmlFor="promo-amount">AED off each</label><input className="input" id="promo-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="1.00" /></div> : null}
          {kind === "multi_buy_free" || kind === "multi_buy_price" ? <div className="field"><label htmlFor="promo-buy">{kind === "multi_buy_free" ? "Buy" : "How many"}</label><input className="input" id="promo-buy" type="number" min={kind === "multi_buy_price" ? 2 : 1} max={99} value={buyQty} onChange={(event) => setBuyQty(event.target.value)} /></div> : null}
          {kind === "multi_buy_free" ? <div className="field"><label htmlFor="promo-get">Get free</label><input className="input" id="promo-get" type="number" min={1} max={99} value={getQty} onChange={(event) => setGetQty(event.target.value)} /></div> : null}
          {kind === "multi_buy_price" ? <div className="field"><label htmlFor="promo-bundle">For AED</label><input className="input" id="promo-bundle" inputMode="decimal" value={bundle} onChange={(event) => setBundle(event.target.value)} placeholder="10.00" /></div> : null}
          {basket ? <div className="field"><label htmlFor="promo-min">When the bill is at least (AED)</label><input className="input" id="promo-min" inputMode="decimal" value={minBasket} onChange={(event) => setMinBasket(event.target.value)} placeholder="200.00" /></div> : null}
          <div className="field"><label htmlFor="promo-start">From</label><input className="input" id="promo-start" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} required /></div>
          <div className="field"><label htmlFor="promo-end">Until (optional)</label><input className="input" id="promo-end" type="date" value={endsOn} min={startsOn} onChange={(event) => setEndsOn(event.target.value)} /></div>
          <fieldset className="field full-span promo-days"><legend className="field-label">Days (none ticked = every day)</legend>
            {DAY_NAMES.map((label, index) => <label key={label} className="promo-day"><input type="checkbox" checked={days.includes(index + 1)} onChange={(event) => setDays((current) => event.target.checked ? [...current, index + 1] : current.filter((day) => day !== index + 1))} /> {label}</label>)}
          </fieldset>
          <div className="field"><label htmlFor="promo-from-time">Hours from (optional)</label><input className="input" id="promo-from-time" type="time" value={fromTime} onChange={(event) => setFromTime(event.target.value)} /></div>
          <div className="field"><label htmlFor="promo-to-time">to</label><input className="input" id="promo-to-time" type="time" value={toTime} onChange={(event) => setToTime(event.target.value)} /></div>
          <p className="field-hint full-span promo-preview">{describePromotion(draft, targetName)}</p>
        </div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div>
        <div className="modal-footer"><button type="button" className="button" onClick={onCancel}>Cancel</button><button className="button primary" type="submit" disabled={busy}>Save promotion</button></div>
      </form>
    </div>
  );
}
