"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { NOTE_MAX, parseFlagSeen } from "@/lib/admin/actions";
import { requestConfirm } from "@/lib/ui/confirm-store";
import { toast } from "@/lib/ui/toast-store";

/** One open flag, already in plain words (the page formats it on the server). */
export type BillingFlagView = { id: string; label: string; ours: string; theirs: string; firstSeen: string; lastSeen: string };

type Props = { shopId: string; shopName: string; flags: BillingFlagView[]; lastChecked: string };

const button = "button";
const primary = "button primary";

type RunResult = { checked?: number; mismatches?: number; failed?: number; error?: string };

export function BillingCheck({ shopId, shopName, flags, lastChecked }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function runCheck() {
    const ok = await requestConfirm({
      title: `Run the billing check for ${shopName}?`,
      body: "Compares this shop's billing record with Stripe and flags anything that disagrees. Nothing is changed.",
      confirmLabel: "Run check",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const response = await fetch("/api/v1/admin/billing-check", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessId: shopId }),
      });
      const result = (await response.json().catch(() => null)) as RunResult | null;
      if (!response.ok || !result || result.error) {
        toast(result?.error ?? "That did not work. Try again.");
      } else if (result.failed) {
        toast("Stripe could not be reached for this shop. Try again.");
      } else if (!result.checked) {
        toast("This shop has no Stripe subscription to check.");
      } else {
        toast(result.mismatches ? `Check done: ${result.mismatches} ${result.mismatches === 1 ? "thing disagrees" : "things disagree"}` : "Check done: everything agrees");
      }
      router.refresh();
    } catch {
      toast("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setOpen(open === id ? null : id);
    setNote("");
    setError("");
  }

  async function markSeen(event: FormEvent, flag: BillingFlagView) {
    event.preventDefault();
    const preview = parseFlagSeen({ note });
    if (!preview.ok) { setError(preview.error); return; }
    const ok = await requestConfirm({
      title: `Mark this flag for ${shopName} as looked at?`,
      body: `${flag.label}: ours ${flag.ours}, Stripe ${flag.theirs}. It opens again if the next check still disagrees.`,
      confirmLabel: "Mark looked at",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/admin/shops/${shopId}/flags/${flag.id}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) { setError(result?.error ?? "That did not work. Try again."); return; }
      setOpen(null);
      toast("Flag marked looked at");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-stack">
      <div className="admin-row between">
        <p className="admin-muted">Last checked: {lastChecked}</p>
        <button type="button" className={button} onClick={runCheck} disabled={busy}>{busy && open === null ? "Checking…" : "Run billing check now"}</button>
      </div>

      {flags.length ? (
        <ul className="admin-list flags">
          {flags.map((flag) => (
            <li key={flag.id} className="admin-flag">
              <div className="admin-row between">
                <div style={{ minWidth: 0 }}>
                  <div className="admin-flag-title">{flag.label}</div>
                  <div>Ours: {flag.ours} · Stripe: {flag.theirs}</div>
                  <div className="admin-muted">First seen {flag.firstSeen} · last seen {flag.lastSeen}</div>
                </div>
                <button type="button" className={button} aria-expanded={open === flag.id} onClick={() => toggle(flag.id)} disabled={busy}>Mark looked at</button>
              </div>
              {open === flag.id ? (
                <form onSubmit={(event) => markSeen(event, flag)} className="admin-form">
                  <div className="field">
                    <label htmlFor={`flag-note-${flag.id}`}>Note (required, up to {NOTE_MAX} characters)</label>
                    <textarea id={`flag-note-${flag.id}`} className="textarea" rows={2} maxLength={NOTE_MAX} required
                      value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>
                  <div className="admin-form-actions">
                    <button type="submit" className={primary} disabled={busy}>{busy ? "Saving…" : "Mark looked at"}</button>
                    <button type="button" className={button} onClick={() => toggle(flag.id)} disabled={busy}>Cancel</button>
                    {error ? <p role="alert" className="form-error">{error}</p> : null}
                  </div>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="admin-muted">No open flags.</p>}
    </div>
  );
}
