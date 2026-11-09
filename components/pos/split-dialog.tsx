"use client";

import { CheckCircle, X } from "@/components/icons";
import { FormEvent, useState } from "react";
import { parseMoneyInput } from "@/lib/checkout/pricing";
import { formatAED } from "@/lib/domain";
import { PAY_METHODS, REFERENCE_MAX, restOn, splitSummary, toPayments, type PayMethod, type Payment, type SplitDraft } from "@/lib/payments/split";

const LABEL: Record<PayMethod, string> = { cash: "Cash", card: "Card", transfer: "Bank transfer" };
const asInput = (fils: number | undefined) => (fils ? (fils / 100).toFixed(2) : "");

type Props = {
  totalFils: number;
  error?: string;
  onCancel: () => void;
  /** The payment rows, and the cash handed over (null when there is no cash part). */
  onComplete: (payments: Payment[], cashReceivedFils: number | null) => void;
};

/** Stage 2B (Pro): one sale paid by cash, card and bank transfer in any mix. Change comes from the cash part only. */
export function SplitDialog({ totalFils, error, onCancel, onComplete }: Props) {
  const [inputs, setInputs] = useState<Record<PayMethod, string>>({ cash: "", card: "", transfer: "" });
  const [received, setReceived] = useState("");
  const [reference, setReference] = useState("");

  const draft: SplitDraft = {};
  let badInput = false;
  for (const method of PAY_METHODS) {
    if (!inputs[method].trim()) continue;
    const fils = parseMoneyInput(inputs[method]);
    if (fils === null) badInput = true;
    else draft[method] = fils;
  }
  const cashPart = draft.cash ?? 0;
  const receivedFils = cashPart > 0 ? (received.trim() ? parseMoneyInput(received) : cashPart) : null;
  const summary = splitSummary(totalFils, draft, receivedFils);
  const problem = badInput ? "Enter amounts like 50 or 50.25." : receivedFils === null && cashPart > 0 ? "Enter the cash received." : summary.ok ? null : summary.error;

  function fill(method: PayMethod) {
    const next = restOn(totalFils, draft, method);
    setInputs((current) => ({ ...current, [method]: asInput(next[method]) }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (problem) return;
    onComplete(toPayments(draft, reference, () => crypto.randomUUID()), cashPart > 0 ? receivedFils : null);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}>
      <form className="modal payment-dialog split-dialog" onSubmit={submit} aria-label="Split payment">
        <div className="modal-header">
          <div><div className="panel-title">Split payment</div><div className="panel-subtitle">Total due {formatAED(totalFils)}</div></div>
          <button type="button" className="button icon-only" onClick={onCancel} aria-label="Close"><X size={16} weight="bold" /></button>
        </div>
        <div className="modal-body">
          {PAY_METHODS.map((method) => (
            <div className="split-line" key={method}>
              <div className="field">
                <label htmlFor={`split-${method}`}>{LABEL[method]} (AED)</label>
                <input className="input" id={`split-${method}`} inputMode="decimal" value={inputs[method]} autoFocus={method === "cash"}
                  onChange={(event) => setInputs((current) => ({ ...current, [method]: event.target.value }))} onFocus={(event) => event.currentTarget.select()} />
              </div>
              <button type="button" className="button" onClick={() => fill(method)}>Rest on {method === "transfer" ? "transfer" : method}</button>
              {method === "card" && (draft.card ?? 0) > 0 ? <p className="field-hint">Take {formatAED(draft.card!)} on the card machine.</p> : null}
              {method === "transfer" && (draft.transfer ?? 0) > 0 ? (
                <div className="field"><label htmlFor="split-reference">Transfer reference (optional)</label><input className="input" id="split-reference" maxLength={REFERENCE_MAX} value={reference} onChange={(event) => setReference(event.target.value)} /></div>
              ) : null}
            </div>
          ))}
          {cashPart > 0 ? (
            <div className="field">
              <label htmlFor="split-received">Cash received (AED)</label>
              <input className="input" id="split-received" inputMode="decimal" placeholder={asInput(cashPart)} value={received} onChange={(event) => setReceived(event.target.value)} />
            </div>
          ) : null}
          <div className="change-due" aria-live="polite"><span>Left to pay</span><strong>{formatAED(Math.max(0, summary.leftFils))}</strong></div>
          {cashPart > 0 && summary.changeFils !== null && summary.changeFils > 0 ? <div className="change-due"><span>Change due</span><strong>{formatAED(summary.changeFils)}</strong></div> : null}
          {problem && (summary.leftFils !== totalFils || badInput) ? <p className="form-error">{problem}</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
        <div className="modal-footer">
          <button type="button" className="button" onClick={onCancel}>Cancel</button>
          <button className="button primary" type="submit" disabled={Boolean(problem)}><CheckCircle size={16} weight="bold" />Complete sale</button>
        </div>
      </form>
    </div>
  );
}
