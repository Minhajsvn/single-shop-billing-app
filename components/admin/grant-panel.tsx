"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { adminErrorMessage, GRANTABLE_PLANS, NOTE_MAX, parseGrantPlan, parseRevokeGrant } from "@/lib/admin/actions";
import { adminDateTime } from "@/lib/admin/shop-view";
import type { AdminGrant } from "@/lib/admin/shops";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { requestConfirm } from "@/lib/ui/confirm-store";
import { toast } from "@/lib/ui/toast-store";

type Props = {
  shopId: string;
  /** The plan grant in force, or null. */
  grant: AdminGrant | null;
  /** The shop has a live Stripe subscription (an id and a status other than canceled): granting is refused. */
  paysThroughStripe: boolean;
};

type Mode = "grant" | "revoke" | null;
type UntilChoice = "date" | "open";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's date in Dubai as YYYY-MM-DD, for the date input's minimum. */
function dubaiToday(now: Date): string {
  return new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const planName = (id: string) => PLANS[id as PlanId]?.name ?? id;

function endsInText(endsAt: string, now: Date): string {
  const days = Math.ceil((new Date(endsAt).getTime() - now.getTime()) / DAY_MS);
  if (days <= 0) return "Ends today";
  return days === 1 ? "Ends in 1 day" : `Ends in ${days} days`;
}

export function GrantPanel({ shopId, grant, paysThroughStripe }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [planId, setPlanId] = useState<PlanId>(grant?.planId ?? "pro");
  const [untilChoice, setUntilChoice] = useState<UntilChoice>("date");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const today = dubaiToday(new Date());

  function open(next: Mode) {
    setMode(next === mode ? null : next);
    setPlanId(grant?.planId ?? "pro");
    setUntilChoice("date");
    setDate("");
    setNote("");
    setError("");
  }

  async function send(method: "POST" | "DELETE", body: object, done: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/admin/shops/${shopId}/grant`, {
        method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(result?.error ?? "That did not work. Try again.");
        return;
      }
      setMode(null);
      toast(done);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitGrant(event: FormEvent) {
    event.preventDefault();
    const body = { planId, until: untilChoice === "open" ? "open" : date, note };
    const preview = parseGrantPlan(body, new Date());
    if (!preview.ok) { setError(preview.error); return; }
    const ok = await requestConfirm({
      title: `Grant the ${planName(planId)} plan?`,
      body: `The shop gets full access on the ${planName(planId)} plan ${preview.until ? `until ${adminDateTime(preview.until)}` : "until you revoke it"}.${grant ? " This replaces the current grant." : ""} The owner will see that Shop Ledger provides the plan, and cannot start a checkout meanwhile.`,
      confirmLabel: "Grant plan",
    });
    if (ok) await send("POST", body, "Plan granted");
  }

  async function submitRevoke(event: FormEvent) {
    event.preventDefault();
    const body = { note };
    const preview = parseRevokeGrant(body);
    if (!preview.ok) { setError(preview.error); return; }
    const ok = await requestConfirm({
      title: "Revoke the granted plan?",
      body: "The shop goes back to whatever its subscription says. For an expired trial that means read-only. No data is changed.",
      confirmLabel: "Revoke grant",
      destructive: true,
    });
    if (ok) await send("DELETE", body, "Grant revoked");
  }

  const noteField = (
    <div className="field">
      <label htmlFor="grant-note">Note (required, up to {NOTE_MAX} characters)</label>
      <textarea id="grant-note" className="textarea" rows={2} maxLength={NOTE_MAX} required value={note} onChange={(e) => setNote(e.target.value)} />
    </div>
  );
  const footer = (label: string, danger = false) => (
    <div className="admin-form-actions">
      <button type="submit" className={`button ${danger ? "danger" : "primary"}`} disabled={busy}>{busy ? "Saving…" : label}</button>
      <button type="button" className="button" onClick={() => open(null)} disabled={busy}>Cancel</button>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
    </div>
  );

  return (
    <section className="panel" aria-labelledby="grant-title">
      <div className="panel-header">
        <div>
          <h2 className="panel-title" id="grant-title">Granted plan</h2>
          <div className="panel-subtitle">Full access on a plan, given by Shop Ledger</div>
        </div>
        {grant?.endingSoon && grant.endsAt ? <span className="badge yellow" suppressHydrationWarning>{endsInText(grant.endsAt, new Date())}</span> : null}
      </div>
      <div className="panel-body admin-stack">
        {grant ? (
          <dl className="admin-fields">
            <dt>Plan</dt><dd><span className="badge blue">{planName(grant.planId)}</span></dd>
            <dt>Until</dt><dd>{grant.endsAt ? adminDateTime(grant.endsAt) : "Until revoked"}</dd>
            <dt>Granted by</dt><dd>{grant.grantedByEmail || "—"}</dd>
            <dt>Given</dt><dd>{adminDateTime(grant.createdAt)}</dd>
            <dt>Note</dt><dd>{grant.note || "—"}</dd>
          </dl>
        ) : <p className="admin-muted" style={{ margin: 0 }}>No plan is granted. The shop is on whatever its subscription says.</p>}

        {paysThroughStripe ? <p className="notice" style={{ margin: 0 }} role="status">{adminErrorMessage("stripe_subscription_live")}</p> : null}

        <div className="admin-row">
          <button type="button" className="button" aria-expanded={mode === "grant"} disabled={paysThroughStripe} onClick={() => open("grant")}>
            {grant ? "Change grant" : "Grant a plan"}
          </button>
          {grant ? <button type="button" className="button" aria-expanded={mode === "revoke"} onClick={() => open("revoke")}>Revoke grant</button> : null}
        </div>

        {mode === "grant" ? (
          <form onSubmit={submitGrant} className="admin-form">
            <div className="field">
              <label htmlFor="grant-plan">Plan</label>
              <select id="grant-plan" className="select" value={planId} onChange={(e) => setPlanId(e.target.value as PlanId)}>
                {GRANTABLE_PLANS.map((id) => <option key={id} value={id}>{planName(id)}</option>)}
              </select>
            </div>
            <fieldset className="admin-choices">
              <legend>Until</legend>
              <label className="admin-choice">
                <input type="radio" name="grant-until" checked={untilChoice === "date"} onChange={() => setUntilChoice("date")} /> On
                <input type="date" className="input" min={today} value={date} aria-label="Grant end date"
                  onChange={(e) => { setDate(e.target.value); setUntilChoice("date"); }} />
              </label>
              <label className="admin-choice">
                <input type="radio" name="grant-until" checked={untilChoice === "open"} onChange={() => setUntilChoice("open")} /> Until revoked
              </label>
            </fieldset>
            <p className="admin-muted" style={{ margin: 0 }}>A date means the end of that day, Dubai time. A new grant replaces the current one.</p>
            {noteField}
            {footer("Grant plan")}
          </form>
        ) : null}

        {mode === "revoke" ? (
          <form onSubmit={submitRevoke} className="admin-form">
            <p style={{ margin: 0, fontSize: 13 }}>Revoking takes effect now.</p>
            {noteField}
            {footer("Revoke grant", true)}
          </form>
        ) : null}
      </div>
    </section>
  );
}
