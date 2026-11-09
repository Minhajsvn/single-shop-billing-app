"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { NOTE_MAX, parseRevokeFounder } from "@/lib/admin/actions";
import { adminDateTime, founderText, type AdminFounder } from "@/lib/admin/shop-view";
import { requestConfirm } from "@/lib/ui/confirm-store";
import { toast } from "@/lib/ui/toast-store";

type Props = {
  shopId: string;
  /** The shop's Founding 50 record (any state), or null when it never had a seat. */
  founder: AdminFounder | null;
};

/** Founding 50 status for one shop, with the staff action to take the seat back. */
export function FounderPanel({ shopId, founder }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const holdsSeat = founder !== null && founder.endReason !== "revoked";

  function toggle() {
    setOpen(!open);
    setNote("");
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = { note };
    const preview = parseRevokeFounder(body);
    if (!preview.ok) { setError(preview.error); return; }
    const ok = await requestConfirm({
      title: "Revoke this founding seat?",
      body: "The shop loses Pro features and goes back to Starter limits now. The seat is freed for the next shop that pays. The shop can never be a founder again.",
      confirmLabel: "Revoke seat",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/admin/shops/${shopId}/founder`, {
        method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(result?.error ?? "That did not work. Try again.");
        return;
      }
      setOpen(false);
      toast("Founding seat revoked");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="founder-title">
      <div className="panel-header">
        <div>
          <h2 className="panel-title" id="founder-title">Founding 50</h2>
          <div className="panel-subtitle">Pro features at the Starter price for 12 months</div>
        </div>
        {holdsSeat && !founder.endReason ? <span className="badge blue">Founding member #{founder.seatNo}</span> : null}
      </div>
      <div className="panel-body admin-stack">
        {founder ? (
          <dl className="admin-fields">
            <dt>Status</dt><dd suppressHydrationWarning>{founderText(founder, new Date())}</dd>
            <dt>Claimed</dt><dd>{adminDateTime(founder.claimedAt)}</dd>
            <dt>Ends</dt><dd>{adminDateTime(founder.endsAt)}</dd>
          </dl>
        ) : <p className="admin-muted" style={{ margin: 0 }}>Not a founding member.</p>}

        {holdsSeat ? (
          <div className="admin-row">
            <button type="button" className="button" aria-expanded={open} onClick={toggle}>Revoke founder seat</button>
          </div>
        ) : null}

        {open ? (
          <form onSubmit={submit} className="admin-form">
            <p style={{ margin: 0, fontSize: 13 }}>Revoking takes effect now and frees the seat.</p>
            <div className="field">
              <label htmlFor="founder-note">Note (required, up to {NOTE_MAX} characters)</label>
              <textarea id="founder-note" className="textarea" rows={2} maxLength={NOTE_MAX} required value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="admin-form-actions">
              <button type="submit" className="button danger" disabled={busy}>{busy ? "Saving…" : "Revoke seat"}</button>
              <button type="button" className="button" onClick={toggle} disabled={busy}>Cancel</button>
              {error ? <p role="alert" className="form-error">{error}</p> : null}
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}
