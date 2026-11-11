"use client";

import { Plus, X } from "@/components/icons";
import { FormEvent, useState } from "react";
import { formatAED, type Product } from "@/lib/domain";
import { formatKg, parseKgInput, perKgText, priceForGrams } from "@/lib/weighing/kg";

/** Stage 2F: type the weight of a product sold by weight (kg, up to 3 decimals) and see its price before adding it. */
export function WeightDialog({ product, availableGrams, onAdd, onCancel }: { product: Product; availableGrams: number; onAdd: (grams: number) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const grams = parseKgInput(text);
  const tooMuch = grams !== null && grams > availableGrams;
  const error = !text.trim() ? "" : grams === null ? "Enter a weight from 0.001 to 100 kg." : tooMuch ? `Only ${formatKg(availableGrams)} in stock.` : "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (grams !== null && !tooMuch) onAdd(grams);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}>
      <form className="modal weight-dialog" onSubmit={submit} aria-label={`Weigh ${product.name}`}>
        <div className="modal-header">
          <div><div className="panel-title">{product.name}</div><div className="panel-subtitle">{perKgText(product.priceFils)} · {formatKg(availableGrams)} in stock</div></div>
          <button type="button" className="button icon-only" onClick={onCancel} aria-label="Close"><X size={16} weight="bold" /></button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label htmlFor="weight-kg">Weight (kg)</label>
            <input className="input" id="weight-kg" inputMode="decimal" value={text} onChange={(event) => setText(event.target.value)} placeholder="0.750" autoFocus autoComplete="off" />
          </div>
          {grams !== null && !tooMuch ? <p className="page-copy">{formatKg(grams)} × {perKgText(product.priceFils)} = <strong>{formatAED(priceForGrams(product.priceFils, grams))}</strong></p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
        <div className="modal-footer">
          <button type="button" className="button" onClick={onCancel}>Cancel</button>
          <button className="button primary" type="submit" disabled={grams === null || tooMuch}><Plus size={16} weight="bold" />Add</button>
        </div>
      </form>
    </div>
  );
}
