"use client";

import { Tag, X } from "@/components/icons";
import { FormEvent, useState } from "react";
import { discountedUnit, parseMoneyInput, type LineDiscount } from "@/lib/checkout/pricing";
import { formatAED } from "@/lib/domain";

type Line = { name: string; unitGrossFils: number; listUnitGrossFils?: number };

/** Per-item discount: a percentage, or an amount off each unit. The charged unit price stays in whole fils. */
export function LineDiscountDialog({ line, onApply, onRemove, onCancel }: { line: Line; onApply: (unitGrossFils: number) => void; onRemove: () => void; onCancel: () => void }) {
  const listPrice = line.listUnitGrossFils ?? line.unitGrossFils;
  const [kind, setKind] = useState<LineDiscount["kind"]>("percent");
  const [value, setValue] = useState("");

  const discount: LineDiscount | null = kind === "percent"
    ? (value.trim() && Number.isFinite(Number(value)) ? { kind, percent: Number(value) } : null)
    : (() => { const fils = parseMoneyInput(value); return fils === null ? null : { kind, offEachFils: fils }; })();
  const result = discount ? discountedUnit(listPrice, discount) : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (result?.ok) onApply(result.unitGrossFils);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}>
      <form className="modal discount-dialog" onSubmit={submit} aria-label={`Discount ${line.name}`}>
        <div className="modal-header">
          <div><div className="panel-title">Discount</div><div className="panel-subtitle">{line.name} · {formatAED(listPrice)} each</div></div>
          <button type="button" className="button icon-only" onClick={onCancel} aria-label="Close"><X size={16} weight="bold" /></button>
        </div>
        <div className="modal-body">
          <div className="segmented" role="radiogroup" aria-label="Discount type">
            <button type="button" role="radio" aria-checked={kind === "percent"} className={`button ${kind === "percent" ? "primary" : ""}`} onClick={() => setKind("percent")}>%</button>
            <button type="button" role="radio" aria-checked={kind === "amount"} className={`button ${kind === "amount" ? "primary" : ""}`} onClick={() => setKind("amount")}>AED off each</button>
          </div>
          <div className="field">
            <label htmlFor="discount-value">{kind === "percent" ? "Percent off" : "Amount off each (AED)"}</label>
            <input className="input" id="discount-value" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
          </div>
          {result?.ok ? <p className="page-copy">{line.name}: {formatAED(listPrice)} → <strong>{formatAED(result.unitGrossFils)}</strong> each</p> : null}
          {result && !result.ok ? <p className="form-error" role="alert">{result.error}</p> : null}
        </div>
        <div className="modal-footer">
          {line.listUnitGrossFils ? <button type="button" className="button" onClick={onRemove}>Remove discount</button> : <button type="button" className="button" onClick={onCancel}>Cancel</button>}
          <button className="button primary" type="submit" disabled={!result?.ok}><Tag size={16} weight="bold" />Apply</button>
        </div>
      </form>
    </div>
  );
}
