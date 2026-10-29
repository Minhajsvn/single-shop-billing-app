"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { NOTE_MAX, parseAddMember, parseMemberChange, parsePasswordReset } from "@/lib/admin/actions";
import { adminDateTime } from "@/lib/admin/shop-view";
import type { AdminMember } from "@/lib/admin/shops";
import { requestConfirm } from "@/lib/ui/confirm-store";
import { toast } from "@/lib/ui/toast-store";

type Props = {
  shopId: string;
  /** Owner first, then oldest first. */
  members: AdminMember[];
  /** The shop's member limit; null = unlimited. */
  membersAllowed: number | null;
};

type Role = "cashier" | "manager";
type Action = { type: "role"; role: Role } | { type: "status"; status: "active" | "disabled" } | { type: "reset" };
type Dialog = { kind: "add" } | { kind: "member"; member: AdminMember; action: Action } | null;

const ROLE_LABEL: Record<AdminMember["role"], string> = { owner: "Owner", manager: "Manager", cashier: "Cashier" };

/** Title, confirm text and success toast for one member action, in plain words. */
function actionCopy(member: AdminMember, action: Action): { title: string; body: string; confirm: string; done: string; destructive?: boolean } {
  if (action.type === "role") {
    const role = ROLE_LABEL[action.role].toLowerCase();
    return { title: `Make ${member.email} a ${role}`, body: `${member.email} becomes a ${role} of this shop.`, confirm: `Make ${role}`, done: `Role changed to ${role}` };
  }
  if (action.type === "status") {
    return action.status === "disabled"
      ? { title: `Disable ${member.email}`, body: `${member.email} cannot use this shop until you enable them again. Their sales and data stay.`, confirm: "Disable", done: "Member disabled", destructive: true }
      : { title: `Enable ${member.email}`, body: `${member.email} can use this shop again. It is refused if the plan has no free member places.`, confirm: "Enable", done: "Member enabled" };
  }
  return { title: `Send ${member.email} a reset email`, body: `${member.email} gets the standard password reset email. You never see or set the password.`, confirm: "Send reset email", done: "Reset email sent" };
}

/** The shared dialog frame (same classes as the shop app's dialogs). Escape and a click outside close it. */
function DialogFrame({ title, subtitle, onClose, onSubmit, footer, children }: {
  title: string; subtitle?: string; onClose: () => void; onSubmit: (event: FormEvent) => void; footer: ReactNode; children: ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
  }, []);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <form ref={form} className="modal" role="dialog" aria-modal="true" aria-label={title} onSubmit={onSubmit}>
        <div className="modal-header">
          <div>
            <div className="panel-title">{title}</div>
            {subtitle ? <div className="panel-subtitle">{subtitle}</div> : null}
          </div>
          <button type="button" className="button icon-only" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body admin-stack">{children}</div>
        <div className="modal-footer">{footer}</div>
      </form>
    </div>
  );
}

export function MembersPanel({ shopId, members, membersAllowed }: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("cashier");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const used = members.filter((m) => m.status === "active").length;
  const places = membersAllowed === null ? `${used} active · no limit` : `${used} of ${membersAllowed} places used`;

  function openDialog(next: Dialog) {
    setDialog(next);
    setEmail("");
    setRole("cashier");
    setNote("");
    setError("");
  }

  async function send(method: "POST" | "PATCH", path: string, body: object, done: (result: { invited?: boolean } | null) => string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/admin/shops/${shopId}/${path}`, {
        method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => null)) as { error?: string; invited?: boolean } | null;
      if (!response.ok) {
        setError(result?.error ?? "That did not work. Try again.");
        return;
      }
      setDialog(null);
      toast(done(result));
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitAdd(event: FormEvent) {
    event.preventDefault();
    const body = { email, role, note };
    const preview = parseAddMember(body);
    if (!preview.ok) { setError(preview.error); return; }
    const ok = await requestConfirm({
      title: `Add ${preview.email} as a ${preview.role}?`,
      body: "If they have no account yet, they get an invite email and set their own password. If they have one, they see this shop the next time they open the app.",
      confirmLabel: "Add user",
    });
    if (ok) await send("POST", "members", body, (result) => (result?.invited ? "Invite sent" : "User added"));
  }

  async function submitMember(event: FormEvent, member: AdminMember, action: Action) {
    event.preventDefault();
    const copy = actionCopy(member, action);
    const body = action.type === "role" ? { role: action.role, note } : action.type === "status" ? { status: action.status, note } : { note };
    const preview = action.type === "reset" ? parsePasswordReset(body) : parseMemberChange(body);
    if (!preview.ok) { setError(preview.error); return; }
    const ok = await requestConfirm({ title: `${copy.title}?`, body: copy.body, confirmLabel: copy.confirm, destructive: copy.destructive });
    if (!ok) return;
    if (action.type === "reset") await send("POST", `members/${member.id}/password-reset`, body, () => copy.done);
    else await send("PATCH", `members/${member.id}`, body, () => copy.done);
  }

  const noteField = (
    <div className="field">
      <label htmlFor="member-note">Note (required, up to {NOTE_MAX} characters)</label>
      <textarea id="member-note" className="textarea" rows={2} maxLength={NOTE_MAX} required value={note} onChange={(e) => setNote(e.target.value)} />
    </div>
  );
  const footer = (label: string, danger = false) => (
    <>
      {error ? <p role="alert" className="form-error" style={{ margin: "0 auto 0 0" }}>{error}</p> : null}
      <button type="button" className="button" onClick={() => setDialog(null)} disabled={busy}>Cancel</button>
      <button type="submit" className={`button ${danger ? "danger" : "primary"}`} disabled={busy}>{busy ? "Saving…" : label}</button>
    </>
  );

  return (
    <>
    <section className="panel" aria-labelledby="members-title">
      <div className="panel-header">
        <div>
          <h2 className="panel-title" id="members-title">Members</h2>
          <div className="panel-subtitle">{places}</div>
        </div>
        <button type="button" className="button primary" onClick={() => openDialog({ kind: "add" })}>Add user</button>
      </div>

      <div className="table-wrap stack-table admin-table admin-members">
        <table>
          <thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td data-label="Member">
                  <div className="product-name">{m.email || "—"}</div>
                  <div className="admin-muted">Joined {adminDateTime(m.createdAt)} · Last sign-in {m.lastSignInAt ? adminDateTime(m.lastSignInAt) : "never"}</div>
                </td>
                <td data-label="Role"><span className={`badge ${m.isOwner || m.role === "manager" ? "blue" : ""}`}>{ROLE_LABEL[m.role]}</span></td>
                <td data-label="Status"><span className={`badge ${m.status === "active" ? "green" : "red"}`}>{m.status === "active" ? "Active" : "Disabled"}</span></td>
                <td data-label="Actions">
                  {m.isOwner ? <span className="admin-muted">Owner</span> : (
                    <div className="admin-member-actions">
                      <button type="button" className="button"
                        onClick={() => openDialog({ kind: "member", member: m, action: { type: "role", role: m.role === "manager" ? "cashier" : "manager" } })}>
                        {m.role === "manager" ? "Make cashier" : "Make manager"}
                      </button>
                      <button type="button" className="button"
                        onClick={() => openDialog({ kind: "member", member: m, action: { type: "status", status: m.status === "active" ? "disabled" : "active" } })}>
                        {m.status === "active" ? "Disable" : "Enable"}
                      </button>
                      <button type="button" className="button" onClick={() => openDialog({ kind: "member", member: m, action: { type: "reset" } })}>Send reset email</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {members.length === 0 ? <p className="admin-empty">No members.</p> : null}
      </div>
    </section>

      {dialog?.kind === "add" ? (
        <DialogFrame title="Add user" subtitle="Cashier or manager" onClose={() => setDialog(null)} onSubmit={submitAdd} footer={footer("Add user")}>
          <div className="field">
            <label htmlFor="member-email">Email</label>
            <input id="member-email" className="input" type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
            <small>An email with no account gets an invite to set its own password.</small>
          </div>
          <div className="field">
            <label htmlFor="member-role">Role</label>
            <select id="member-role" className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="cashier">Cashier</option>
              <option value="manager">Manager</option>
            </select>
          </div>
          {noteField}
        </DialogFrame>
      ) : null}

      {dialog?.kind === "member" ? (
        <DialogFrame title={actionCopy(dialog.member, dialog.action).title} onClose={() => setDialog(null)}
          onSubmit={(event) => submitMember(event, dialog.member, dialog.action)}
          footer={footer(actionCopy(dialog.member, dialog.action).confirm, actionCopy(dialog.member, dialog.action).destructive)}>
          <p className="admin-dialog-warning">{actionCopy(dialog.member, dialog.action).body}</p>
          {noteField}
        </DialogFrame>
      ) : null}
    </>
  );
}
