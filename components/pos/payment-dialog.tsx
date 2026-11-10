"use client";

import { CheckCircle, CreditCard, Money, X } from "@/components/icons";
import { FormEvent, useState } from "react";
import { changeDue, parseMoneyInput, quickCashAmounts } from "@/lib/checkout/pricing";
import { formatAED } from "@/lib/domain";

type Props = {
  method: "cash" | "card" | "transfer";
  totalFils: number;
  error?: string;
  onCancel: () => void;
  /** Cash: the amount received in fils. Card and transfer: null. Transfer also passes its optional reference. */
  onComplete: (tenderedFils: number | null, reference?: string) => void;
};

const asInput = (fils: number) => (fils / 100).toFixed(2);
const TITLE = { cash: "Cash payment", card: "Card payment", transfer: "Bank transfer" } as const;

/** The step between the cart and the invoice: confirm cash received (with change due) or the card terminal approval. */
export function PaymentDialog({ method, totalFils, error, onCancel, onComplete }: Props) {
  const [received, setReceived] = useState(asInput(totalFils));
  const [reference, setReference] = useState("");
  const tenderedFils = parseMoneyInput(received);
  const change = tenderedFils === null ? null : changeDue(totalFils, tenderedFils);
  const cashProblem = method === "cash"
    ? tenderedFils === null ? "Enter the cash received, e.g. 50 or 50.25." : change && !change.ok ? change.error : null
    : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (method === "card") return onComplete(null);
    if (method === "transfer") return onComplete(null, reference.trim().slice(0, 60) || undefined);
    if (!cashProblem && tenderedFils !== null) onComplete(tenderedFils);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}>
      <form className="modal payment-dialog" onSubmit={submit} aria-label={TITLE[method]}>
        <div className="modal-header">
          <div><div className="panel-title">{TITLE[method]}</div><div className="panel-subtitle">Total due {formatAED(totalFils)}</div></div>
          <button type="button" className="button icon-only" onClick={onCancel} aria-label="Close"><X size={16} weight="bold" /></button>
        </div>
        <div className="modal-body">
          {method === "cash" ? (
            <>
              <div className="field">
                <label htmlFor="cash-received">Cash received (AED)</label>
                <input className="input" id="cash-received" inputMode="decimal" value={received} onChange={(event) => setReceived(event.target.value)} onFocus={(event) => event.currentTarget.select()} autoFocus aria-invalid={Boolean(cashProblem)} aria-describedby="cash-feedback" />
              </div>
              <div className="quick-cash" role="group" aria-label="Quick cash amounts">
                {quickCashAmounts(totalFils).map((amount) => (
                  <button type="button" className="button" key={amount} onClick={() => setReceived(asInput(amount))}>{formatAED(amount)}</button>
                ))}
              </div>
              <div id="cash-feedback" aria-live="polite">
                {cashProblem ? <p className="form-error">{cashProblem}</p> : <div className="change-due"><span>Change due</span><strong>{formatAED(change && change.ok ? change.changeFils : 0)}</strong></div>}
              </div>
            </>
          ) : method === "transfer" ? (
            <>
              <p className="page-copy">Confirm the bank transfer of {formatAED(totalFils)} has arrived.</p>
              <div className="field"><label htmlFor="transfer-reference">Transfer reference (optional)</label><input className="input" id="transfer-reference" maxLength={60} value={reference} onChange={(event) => setReference(event.target.value)} autoFocus /></div>
            </>
          ) : (
            <p className="page-copy"><CreditCard size={18} weight="bold" /> Confirm the card terminal approved {formatAED(totalFils)}.</p>
          )}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
        <div className="modal-footer">
          <button type="button" className="button" onClick={onCancel}>Cancel</button>
          <button className="button primary" type="submit" disabled={Boolean(cashProblem)} autoFocus={method === "card"}>
            {method === "cash" ? <Money size={16} weight="bold" /> : <CheckCircle size={16} weight="bold" />}Complete sale
          </button>
        </div>
      </form>
    </div>
  );
}
