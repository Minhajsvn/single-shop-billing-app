"use client";

import { CashRegister, CheckCircle, X } from "@phosphor-icons/react";
import { FormEvent, useState } from "react";
import { staleRegister } from "@/lib/checkout/register-status";
import { addCashAdjustment, closeRegister, getRegisterTotals, openRegister, useDemoStore } from "@/lib/demo-store";
import { formatAED, formatDateTime } from "@/lib/domain";

type Dialog = "open" | "adjust" | "close" | null;

export function RegisterWorkspace() {
  const store = useDemoStore();
  const stale = staleRegister(store.register, new Date());
  const register = store.register;
  const totals = getRegisterTotals(store);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState("");

  function submitOpen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const amount = Math.round(Number(data.get("openingCash")) * 100);
    if (!Number.isFinite(amount) || amount < 0 || !openRegister(amount)) {
      setError("Enter a valid opening balance.");
      return;
    }
    setError("");
    setDialog(null);
  }

  function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const direction = String(data.get("direction"));
    const amount = Math.round(Number(data.get("amount")) * 100) * (direction === "out" ? -1 : 1);
    const reason = String(data.get("reason") ?? "").trim();
    if (!Number.isFinite(amount) || amount === 0 || !reason || !addCashAdjustment(amount, reason)) {
      setError("Enter a valid amount and reason.");
      return;
    }
    setError("");
    setDialog(null);
  }

  function submitClose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const counted = Math.round(Number(data.get("countedCash")) * 100);
    if (!Number.isFinite(counted) || counted < 0 || !closeRegister(counted)) {
      setError("Enter the counted cash before closing.");
      return;
    }
    setError("");
    setDialog(null);
  }

  function dismiss() {
    setError("");
    setDialog(null);
  }

  if (!register || register.status === "closed") {
    return (
      <>
        <div className="page-heading"><div><div className="eyebrow">Daily cash control</div><h1 className="page-title">Register closed</h1><p className="page-copy">Count the physical starting cash before accepting the first sale.</p></div>{register?.varianceFils !== undefined && <span className={`badge ${register.varianceFils === 0 ? "green" : "red"}`}>Last variance {formatAED(register.varianceFils)}</span>}</div>
        <section className="panel register-closed"><CashRegister size={38} weight="duotone" /><h2>Open today’s register</h2><p>The opening balance becomes the starting point for expected drawer cash.</p><button className="button primary" onClick={() => setDialog("open")}>Enter opening balance</button></section>
        {dialog === "open" && <RegisterDialog title="Open register" subtitle="Count only cash physically in the drawer." onClose={dismiss}><form onSubmit={submitOpen}><div className="modal-body"><MoneyField id="openingCash" label="Opening cash" autoFocus />{error && <p className="form-error">{error}</p>}</div><div className="modal-footer"><button type="button" className="button" onClick={dismiss}>Cancel</button><button type="submit" className="button primary">Open register</button></div></form></RegisterDialog>}
      </>
    );
  }

  return (
    <>
      <div className="page-heading"><div><div className="eyebrow">Daily cash control</div><h1 className="page-title">Register</h1><p className="page-copy">Opened {formatDateTime(register.openedAt)}. Card activity is reported separately from drawer cash.</p></div><span className="badge green">Open</span></div>

      <section className="metric-grid register-metrics" aria-label="Current register totals">
        <div className="metric"><div className="metric-label">Opening cash</div><div className="metric-value">{formatAED(register.openingCashFils)}</div><div className="metric-note">Counted at opening</div></div>
        <div className="metric"><div className="metric-label">Cash sales</div><div className="metric-value">{formatAED(totals.cashSalesFils - totals.cashReturnsFils)}</div><div className="metric-note">{formatAED(totals.cashReturnsFils)} returned</div></div>
        <div className="metric"><div className="metric-label">Card sales</div><div className="metric-value">{formatAED(totals.cardSalesFils - totals.cardReturnsFils)}</div><div className="metric-note">{formatAED(totals.cardReturnsFils)} returned</div></div>
        <div className="metric"><div className="metric-label">Expected cash</div><div className="metric-value">{formatAED(totals.expectedCashFils)}</div><div className="metric-note">Includes {formatAED(totals.adjustmentsFils)} adjustments</div></div>
      </section>

      <div className="grid-two register-grid">
        <section className="panel">
          <div className="panel-header"><div><div className="panel-title">Cash movements</div><div className="panel-subtitle">Non-sale additions and removals</div></div><button className="button" onClick={() => setDialog("adjust")}>Record adjustment</button></div>
          {register.adjustments.length ? <div className="table-wrap"><table><thead><tr><th>Time</th><th>Reason</th><th>Direction</th><th className="numeric">Amount</th></tr></thead><tbody>{register.adjustments.map((item) => <tr key={item.id}><td>{formatDateTime(item.createdAt)}</td><td className="product-name">{item.reason}</td><td><span className={`badge ${item.amountFils > 0 ? "green" : "red"}`}>{item.amountFils > 0 ? "Cash in" : "Cash out"}</span></td><td className="numeric">{formatAED(item.amountFils)}</td></tr>)}</tbody></table></div> : <div className="empty compact-empty"><CheckCircle size={28} weight="duotone" /><h3>No manual movements</h3><p>Sales are tracked automatically. Record only non-sale cash additions or removals.</p></div>}
        </section>
        {stale.stale && <div className="notice error-notice" role="alert"><CashRegister size={18} weight="fill" /><div><strong>This register was opened on {stale.openedOn} and is still open.</strong> Count the drawer and close it before the next sale.</div></div>}
        <section className="panel close-panel"><div className="panel-body"><div className="eyebrow">End of day</div><h2>Ready to count?</h2><p>Closing locks this register session. Enter the physical cash count to calculate the variance.</p><button className="button primary" onClick={() => setDialog("close")}>Close register</button></div></section>
      </div>

      {dialog === "adjust" && <RegisterDialog title="Cash adjustment" subtitle="A reason is required for the audit trail." onClose={dismiss}><form onSubmit={submitAdjustment}><div className="modal-body"><div className="form-grid"><div className="field"><label htmlFor="direction">Direction</label><select className="select" id="direction" name="direction"><option value="in">Cash in</option><option value="out">Cash out</option></select></div><MoneyField id="amount" label="Amount" autoFocus /><div className="field full-span"><label htmlFor="reason">Reason</label><textarea className="textarea" id="reason" name="reason" placeholder="Petty cash top-up, safe drop…" required /></div></div>{error && <p className="form-error">{error}</p>}</div><div className="modal-footer"><button type="button" className="button" onClick={dismiss}>Cancel</button><button type="submit" className="button primary">Record movement</button></div></form></RegisterDialog>}

      {dialog === "close" && <RegisterDialog title="Close register" subtitle={`Expected drawer cash: ${formatAED(totals.expectedCashFils)}`} onClose={dismiss}><form onSubmit={submitClose}><div className="modal-body"><MoneyField id="countedCash" label="Counted physical cash" autoFocus /><p className="field-hint">The variance will be counted cash minus expected cash.</p>{error && <p className="form-error">{error}</p>}</div><div className="modal-footer"><button type="button" className="button" onClick={dismiss}>Cancel</button><button type="submit" className="button primary">Confirm and close</button></div></form></RegisterDialog>}
    </>
  );
}

function MoneyField({ id, label, autoFocus = false }: { id: string; label: string; autoFocus?: boolean }) {
  return <div className="field"><label htmlFor={id}>{label} (AED)</label><div className="money-input"><span>AED</span><input className="input" id={id} name={id} type="number" min="0" step="0.01" required autoFocus={autoFocus} /></div></div>;
}

function RegisterDialog({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><div><div className="panel-title">{title}</div><div className="panel-subtitle">{subtitle}</div></div><button type="button" className="button icon-only" onClick={onClose} aria-label="Close"><X size={16} weight="bold" /></button></div>{children}</div></div>;
}
