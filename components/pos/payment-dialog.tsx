"use client";

import { CheckCircle, CreditCard, Money, X } from "@/components/icons";
import { FormEvent, useState } from "react";
import { changeDue, parseMoneyInput, quickCashAmounts } from "@/lib/checkout/pricing";
import { formatAED } from "@/lib/domain";

type Props = {
  method: "cash" | "card";
  totalFils: number;
  error?: string;
  onCancel: () => void;
  /** Cash: the amount received in fils. Card: null. */
  onComplete: (tenderedFils: number | null) => void;
};

const asInput = (fils: number) => (fils / 100).toFixed(2);

/** The step between the cart and the invoice: confirm cash received (with change due) or the card terminal approval. */
export function PaymentDialog({ method, totalFils, error, onCancel, onComplete }: Props) {
  const [received, setReceived] = useState(asInput(totalFils));
  const tenderedFils = parseMoneyInput(received);
  const change = tenderedFils === null ? null : changeDue(totalFils, tenderedFils);
  const cashProblem = method === "cash"
    ? tenderedFils === null ? "Enter the cash received, e.g. 50 or 50.25." : change && !change.ok ? change.error : null
    : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (method === "card") return onComplete(null);
    if (!cashProblem && tenderedFils !== null) onComplete(tenderedFils);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}>
      <form className="modal payment-dialog" onSubmit={submit} aria-label={method === "cash" ? "Cash payment" : "Card payment"}>
        <div className="modal-header">
          <div><div className="panel-title">{method === "cash" ? "Cash payment" : "Card payment"}</div><div className="panel-subtitle">Total due {formatAED(totalFils)}</div></div>
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
