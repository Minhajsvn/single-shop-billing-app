"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { NOTE_MAX, parseEndExtraTill, parseExtendTrial, parseExtraTill } from "@/lib/admin/actions";
import { adminDateTime } from "@/lib/admin/shop-view";
import { requestConfirm } from "@/lib/ui/confirm-store";
import { toast } from "@/lib/ui/toast-store";

type Props = {
  shopId: string;
  shopName: string;
  /** Subscription status, or null when the shop has no subscription row. */
  status: string | null;
  hasPaymentMethod: boolean;
  trialEndsAt: string | null;
  /** False when the plan has no till limit (an extra till means nothing). */
  tillLimited: boolean;
  /** End of the active extra till, or null when there is none. */
  extraTillUntil: string | null;
};

type Panel = "trial" | "give" | "end" | null;
type TrialChoice = "7" | "14" | "date";

const button = "button";
const primary = "button primary";

/** Today's date in Dubai as YYYY-MM-DD, for the date inputs' minimum. */
function dubaiToday(now: Date): string {
  return new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function ShopActions({ shopId, shopName, status, hasPaymentMethod, trialEndsAt, tillLimited, extraTillUntil }: Props) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [trialChoice, setTrialChoice] = useState<TrialChoice>("7");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const trialing = status === "trialing";
  const today = dubaiToday(new Date());

  function open(next: Panel) {
    setPanel(next === panel ? null : next);
    setTrialChoice("7");
    setDate("");
    setNote("");
    setError("");
  }

  async function send(method: "POST" | "DELETE", path: string, body: object, done: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/admin/shops/${shopId}/${path}`, {
        method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(result?.error ?? "That did not work. Try again.");
        return;
      }
      setPanel(null);
      toast(done);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitTrial(event: FormEvent) {
    event.preventDefault();
    const body = trialChoice === "date" ? { until: date, note } : { days: Number(trialChoice), note };
    const preview = parseExtendTrial(body, new Date(), trialEndsAt);
    if (!preview.ok) { setError(preview.error); return; }
    const ok = await requestConfirm({
      title: `Extend the trial for ${shopName}?`,
      body: `The trial will end ${adminDateTime(preview.until)}. The shop gets full access back at its next refresh.`,
      confirmLabel: "Extend trial",
    });
    if (ok) await send("POST", "trial", body, "Trial extended");
  }

  async function submitGive(event: FormEvent) {
    event.preventDefault();
    const body = { until: date, note };
    const preview = parseExtraTill(body, new Date());
    if (!preview.ok) { setError(preview.error); return; }
    const ok = await requestConfirm({
      title: `Give ${shopName} an extra till?`,
      body: `One more till than the plan allows, until ${adminDateTime(preview.until)}.${extraTillUntil ? " The current extra till ends now." : ""}`,
      confirmLabel: "Give extra till",
    });
    if (ok) await send("POST", "extra-till", body, "Extra till given");
  }

  async function submitEnd(event: FormEvent) {
    event.preventDefault();
    const body = { note };
    const preview = parseEndExtraTill(body);
    if (!preview.ok) { setError(preview.error); return; }
    const ok = await requestConfirm({
      title: `End the extra till for ${shopName}?`,
      body: "The extra till ends now. The owner chooses which tills stay at the next register open.",
      confirmLabel: "End extra till",
      destructive: true,
    });
    if (ok) await send("DELETE", "extra-till", body, "Extra till ended");
  }

  const noteField = (
    <div className="field">
      <label htmlFor="action-note">Note (required, up to {NOTE_MAX} characters)</label>
      <textarea id="action-note" className="textarea" rows={2} maxLength={NOTE_MAX} required value={note} onChange={(e) => setNote(e.target.value)} />
    </div>
  );
  const footer = (label: string) => (
    <div className="admin-form-actions">
      <button type="submit" className={primary} disabled={busy}>{busy ? "Saving…" : label}</button>
      <button type="button" className={button} onClick={() => open(null)} disabled={busy}>Cancel</button>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
    </div>
  );

  return (
    <div className="admin-stack">
      <div className="admin-row">
        {trialing && !hasPaymentMethod ? (
          <button type="button" className={button} aria-expanded={panel === "trial"} onClick={() => open("trial")}>Extend trial</button>
        ) : null}
        {status && tillLimited ? (
          <button type="button" className={button} aria-expanded={panel === "give"} onClick={() => open("give")}>Give an extra till</button>
        ) : null}
        {extraTillUntil ? (
          <button type="button" className={button} aria-expanded={panel === "end"} onClick={() => open("end")}>End extra till</button>
        ) : null}
      </div>
      {trialing && hasPaymentMethod ? <p className="admin-muted">This trial has a card on file. Change the trial end in Stripe.</p> : null}
      {!status ? <p className="admin-muted">This shop has no subscription yet.</p> : null}

      {panel === "trial" ? (
        <form onSubmit={submitTrial} className="admin-form">
          <fieldset className="admin-choices">
            <legend>New trial end</legend>
            {(["7", "14"] as const).map((days) => (
              <label key={days} className="admin-choice">
                <input type="radio" name="trial-choice" checked={trialChoice === days} onChange={() => setTrialChoice(days)} /> +{days} days
              </label>
            ))}
            <label className="admin-choice">
              <input type="radio" name="trial-choice" checked={trialChoice === "date"} onChange={() => setTrialChoice("date")} /> On
              <input type="date" className="input" min={today} value={date} aria-label="Trial end date"
                onChange={(e) => { setDate(e.target.value); setTrialChoice("date"); }} />
            </label>
          </fieldset>
          <p className="admin-muted">+7 / +14 count from the later of now and the current trial end. A date means the end of that day, Dubai time.</p>
          {noteField}
          {footer("Extend trial")}
        </form>
      ) : null}

      {panel === "give" ? (
        <form onSubmit={submitGive} className="admin-form">
          <div className="field">
            <label htmlFor="give-until">Until (end of that day, Dubai time)</label>
            <input id="give-until" type="date" className="input" min={today} required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {noteField}
          {footer("Give extra till")}
        </form>
      ) : null}

      {panel === "end" ? (
        <form onSubmit={submitEnd} className="admin-form">
          <p style={{ margin: 0, fontSize: 13 }}>The extra till runs until {adminDateTime(extraTillUntil)}. Ending it takes effect now.</p>
          {noteField}
          {footer("End extra till")}
        </form>
      ) : null}
    </div>
  );
}
