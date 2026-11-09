"use client";

import { Key, UserPlus } from "@/components/icons";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useEntitlement } from "@/components/billing/use-entitlement";
import { refreshSnapshot, useShopContext } from "@/lib/demo-store";
import { formatDateTime } from "@/lib/domain";
import { requestConfirm } from "@/lib/ui/confirm-store";
import { toast } from "@/lib/ui/toast-store";
import { SetPinDialog } from "./set-pin-dialog";

type Row = {
  memberId: string;
  displayName: string;
  email: string | null;
  role: "owner" | "manager" | "cashier";
  status: "active" | "disabled";
  pinSet: boolean;
  lastSaleAt: string | null;
};


async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = (await response.json().catch(() => ({}))) as { error?: string };
  return { ok: response.ok, error: json.error };
}

/** Settings → Staff (owner only): the team, invitations, PINs and the till lock (spec 2A §6). */
export function StaffTab() {
  const { lockSettings } = useShopContext();
  const { hasFeature, e } = useEntitlement();
  const staffRoles = hasFeature("staff_roles");
  const memberLimit = e.limits.members;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [pinFor, setPinFor] = useState<Row | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/staff");
    const body = (await response.json().catch(() => ({}))) as { staff?: Row[]; error?: string };
    if (!response.ok) return setMessage(body.error ?? "The staff list could not be loaded.");
    setRows(body.staff ?? []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function after(result: { ok: boolean; error?: string }, done: string) {
    setBusy("");
    if (!result.ok) return setMessage(result.error ?? "That did not work. Try again.");
    setMessage("");
    toast(done);
    await load();
    void refreshSnapshot();
  }

  async function changeRole(row: Row, role: "cashier" | "manager") {
    setBusy(row.memberId);
    await after(await call(`/api/v1/staff/${row.memberId}`, "PATCH", { role }), `${row.displayName} is now a ${role}`);
  }

  async function changeStatus(row: Row) {
    const disable = row.status === "active";
    if (disable && !(await requestConfirm({ title: `Disable ${row.displayName}?`, body: "They can no longer sign in or unlock a till. Their past sales keep their name.", confirmLabel: "Disable", destructive: true }))) return;
    setBusy(row.memberId);
    await after(await call(`/api/v1/staff/${row.memberId}`, "PATCH", { status: disable ? "disabled" : "active" }), disable ? `${row.displayName} disabled` : `${row.displayName} is active again`);
  }

  async function resetPin(row: Row) {
    if (!(await requestConfirm({ title: `Reset ${row.displayName}'s PIN?`, body: "They cannot use the till until a new PIN is set.", confirmLabel: "Reset PIN", destructive: true }))) return;
    setBusy(row.memberId);
    await after(await call(`/api/v1/staff/${row.memberId}/pin`, "DELETE"), "PIN reset");
  }

  async function resendInvite(row: Row) {
    setBusy(row.memberId);
    await after(await call(`/api/v1/staff/${row.memberId}/invite`, "POST"), `Invitation sent to ${row.email ?? row.displayName}`);
  }

  const owner = rows?.find((row) => row.role === "owner");
  const activeCount = rows?.filter((row) => row.status === "active").length ?? 0;
  const full = memberLimit !== null && activeCount >= memberLimit;

  return (
    <>
      {message ? <p className="form-error" role="alert">{message}</p> : null}

      <section className="panel">
        <div className="panel-header">
          <div><div className="panel-title">Staff</div><div className="panel-subtitle">Everyone who can sign in to this shop{memberLimit !== null ? ` · ${activeCount} of ${memberLimit} users` : ""}</div></div>
          {owner ? <button className="button" type="button" onClick={() => setPinFor(owner)}><Key size={15} weight="bold" />{owner.pinSet ? "Change your PIN" : "Set your PIN"}</button> : null}
        </div>
        {rows === null ? <div className="panel-body"><p className="field-hint">Loading…</p></div> : (
          <div className="table-wrap">
            <table className="table staff-table">
              <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>PIN</th><th>Last sale</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.memberId}>
                    <td><strong>{row.displayName}</strong><div className="product-meta">{row.email}</div></td>
                    <td>{row.role === "owner" ? "Owner" : (
                      <select className="input" aria-label={`Role for ${row.displayName}`} value={row.role} disabled={busy === row.memberId} onChange={(event) => void changeRole(row, event.target.value as "cashier" | "manager")}>
                        <option value="cashier">Cashier</option>
                        <option value="manager">Manager</option>
                      </select>
                    )}</td>
                    <td><span className={`badge ${row.status === "active" ? "green" : ""}`}>{row.status === "active" ? "Active" : "Disabled"}</span></td>
                    <td>{row.pinSet ? "Set" : <span className="field-hint">PIN not set</span>}</td>
                    <td>{row.lastSaleAt ? formatDateTime(row.lastSaleAt) : <span className="field-hint">—</span>}</td>
                    <td className="row-actions">{row.role === "owner" ? null : <>
                      {row.status === "active" ? <button className="button" type="button" disabled={busy === row.memberId} onClick={() => setPinFor(row)}>Set PIN at this till</button> : null}
                      {row.pinSet ? <button className="button" type="button" disabled={busy === row.memberId} onClick={() => void resetPin(row)}>Reset PIN</button> : null}
                      <button className="button" type="button" disabled={busy === row.memberId} onClick={() => void resendInvite(row)}>Resend invite</button>
                      <button className="button" type="button" disabled={busy === row.memberId} onClick={() => void changeStatus(row)}>{row.status === "active" ? "Disable" : "Enable"}</button>
                    </>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <InviteForm full={full} memberLimit={memberLimit} onInvited={async () => { await load(); void refreshSnapshot(); }} />

      <LockSettingsForm allowed={staffRoles} initial={lockSettings} ownerHasPin={!!owner?.pinSet} />

      {pinFor ? (
        <SetPinDialog
          title={pinFor.role === "owner" ? "Your PIN" : `PIN for ${pinFor.displayName}`}
          url={`/api/v1/staff/${pinFor.memberId}/pin`}
          onCancel={() => setPinFor(null)}
          onDone={() => { setPinFor(null); void after({ ok: true }, "PIN saved"); }}
        />
      ) : null}
    </>
  );
}

function InviteForm({ full, memberLimit, onInvited }: { full: boolean; memberLimit: number | null; onInvited: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    const result = await call("/api/v1/staff", "POST", { email: data.get("email"), displayName: data.get("displayName"), role: data.get("role") });
    setBusy(false);
    if (!result.ok) return setError(result.error ?? "The invitation could not be sent.");
    setError("");
    form.reset();
    toast("Invitation sent");
    await onInvited();
  }

  return (
    <form className="panel" onSubmit={(event) => void submit(event)}>
      <div className="panel-header"><div><div className="panel-title">Invite staff</div><div className="panel-subtitle">They get an email to set a password, then set their PIN</div></div></div>
      <div className="panel-body">
        {full ? (
          <p className="field-hint">Your plan allows {memberLimit} users. <Link href="/settings?tab=billing">Upgrade to add more staff</Link>.</p>
        ) : (
          <div className="form-grid">
            <div className="field"><label htmlFor="invite-name">Name</label><input className="input" id="invite-name" name="displayName" required maxLength={60} /></div>
            <div className="field"><label htmlFor="invite-email">Email</label><input className="input" id="invite-email" name="email" type="email" required /></div>
            <div className="field"><label htmlFor="invite-role">Role</label><select className="input" id="invite-role" name="role" defaultValue="cashier"><option value="cashier">Cashier</option><option value="manager">Manager</option></select></div>
          </div>
        )}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
      {full ? null : <div className="modal-footer"><button className="button primary" type="submit" disabled={busy}><UserPlus size={15} weight="bold" />{busy ? "Sending…" : "Send invitation"}</button></div>}
    </form>
  );
}

function LockSettingsForm({ allowed, initial, ownerHasPin }: { allowed: boolean; initial: { pinLockEnabled: boolean; idleLockMinutes: number; managerDiscountPct: number }; ownerHasPin: boolean }) {
  const [enabled, setEnabled] = useState(initial.pinLockEnabled);
  const [minutes, setMinutes] = useState(String(initial.idleLockMinutes));
  const [pct, setPct] = useState(String(initial.managerDiscountPct));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const result = await call("/api/v1/staff/settings", "PUT", { pinLockEnabled: enabled, idleLockMinutes: Number(minutes), managerDiscountPct: Number(pct) });
    setBusy(false);
    if (!result.ok) return setError(result.error ?? "The settings could not be saved.");
    setError("");
    toast("Lock settings saved");
    void refreshSnapshot();
  }

  return (
    <form className="panel" onSubmit={(event) => void submit(event)}>
      <div className="panel-header"><div><div className="panel-title">PIN lock on shared tills</div><div className="panel-subtitle">Staff tap their name and enter their PIN; managers approve refunds and big discounts</div></div></div>
      <div className="panel-body">
        {!allowed ? (
          <p className="field-hint">The PIN lock is part of the Pro plan. <Link href="/settings?tab=billing">See plans</Link>.</p>
        ) : (
          <div className="form-grid">
            <label className="field checkbox-field"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> <span>Lock tills signed in to this account behind staff PINs</span></label>
            <div className="field"><label htmlFor="idle-minutes">Lock after idle (minutes)</label><input className="input" id="idle-minutes" type="number" min={1} max={60} step={1} required value={minutes} onChange={(event) => setMinutes(event.target.value)} /></div>
            <div className="field"><label htmlFor="discount-pct">Manager approval for discounts above (%)</label><input className="input" id="discount-pct" type="number" min={0} max={100} step={1} required value={pct} onChange={(event) => setPct(event.target.value)} /></div>
          </div>
        )}
        {allowed && enabled && !ownerHasPin ? <p className="field-hint">Set your own PIN first, so you can always unlock the till.</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
      {allowed ? <div className="modal-footer"><button className="button primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save lock settings"}</button></div> : null}
    </form>
  );
}
