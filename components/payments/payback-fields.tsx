"use client";

import { useEffect, useState } from "react";
import { parseMoneyInput } from "@/lib/checkout/pricing";
import { formatAED } from "@/lib/domain";
import { PAY_METHODS, restOn, splitSummary, toPayments, type PayMethod, type Payment, type SplitDraft } from "@/lib/payments/split";

const LABEL: Record<PayMethod, string> = { cash: "Cash", card: "Card", transfer: "Bank transfer" };
const asInput = (fils: number | undefined) => (fils ? (fils / 100).toFixed(2) : "");

export type PayBack = { ok: true; pay: Payment[] | PayMethod } | { ok: false; error: string };

/**
 * "Pay back by" on a refund (spec 2B §5.4). Starter: one method. Pro: any mix of cash, card and transfer that adds
 * up to the refund, with no limit per method. Starts with `defaultMethod` for the whole refund; the caller remounts it
 * (key = total) when the refund total changes.
 */
export function PaybackFields({ totalFils, defaultMethod, canSplit, onChange }: { totalFils: number; defaultMethod: PayMethod; canSplit: boolean; onChange: (value: PayBack) => void }) {
  const [single, setSingle] = useState<PayMethod>(defaultMethod);
  const [inputs, setInputs] = useState<Record<PayMethod, string>>({ cash: "", card: "", transfer: "", [defaultMethod]: asInput(totalFils) });
  const [reference, setReference] = useState("");

  const draft: SplitDraft = {};
  let bad = false;
  for (const method of PAY_METHODS) {
    if (!inputs[method].trim()) continue;
    const fils = parseMoneyInput(inputs[method]);
    if (fils === null) bad = true;
    else draft[method] = fils;
  }
  const summary = splitSummary(totalFils, draft, null);

  useEffect(() => {
    if (totalFils <= 0) return onChange({ ok: false, error: "Choose what is coming back." });
    if (!canSplit) return onChange({ ok: true, pay: single });
    if (bad) return onChange({ ok: false, error: "Enter amounts like 10 or 10.50." });
    if (!summary.ok) return onChange({ ok: false, error: summary.error ?? "The pay-back amounts must add up to the refund." });
    onChange({ ok: true, pay: toPayments(draft, reference, () => crypto.randomUUID()) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draft is derived from inputs
  }, [inputs, reference, single, totalFils, canSplit, bad, summary.ok]);

  if (!canSplit) {
    return (
      <fieldset className="payback">
        <legend>Pay back {formatAED(totalFils)} by</legend>
        <div className="segmented" role="radiogroup" aria-label="Pay back by">
          {PAY_METHODS.map((method) => (
            <button key={method} type="button" role="radio" aria-checked={single === method} className={`button ${single === method ? "primary" : ""}`} onClick={() => setSingle(method)}>{LABEL[method]}</button>
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <fieldset className="payback">
      <legend>Pay back {formatAED(totalFils)} by</legend>
      {PAY_METHODS.map((method) => (
        <div className="split-line" key={method}>
          <div className="field">
            <label htmlFor={`payback-${method}`}>{LABEL[method]} (AED)</label>
            <input className="input" id={`payback-${method}`} inputMode="decimal" value={inputs[method]} onChange={(event) => setInputs((current) => ({ ...current, [method]: event.target.value }))} />
          </div>
          <button type="button" className="button" onClick={() => setInputs((current) => ({ ...current, [method]: asInput(restOn(totalFils, draft, method)[method]) }))}>Rest here</button>
        </div>
      ))}
      {(draft.transfer ?? 0) > 0 ? <div className="field"><label htmlFor="payback-reference">Transfer reference (optional)</label><input className="input" id="payback-reference" maxLength={60} value={reference} onChange={(event) => setReference(event.target.value)} /></div> : null}
      <div className="change-due"><span>Left to pay back</span><strong>{formatAED(Math.max(0, summary.leftFils))}</strong></div>
    </fieldset>
  );
}
