"use client";

import { X } from "@/components/icons";
import { useState, type FormEvent } from "react";
import { saveSupplier } from "@/lib/purchasing/client";
import type { Supplier } from "@/lib/purchasing/types";

/** Stage 2D: add or edit a supplier. The id is made here for a new one; saving the same id again updates it. */
export function SupplierForm({ supplier, onSaved, onCancel }: { supplier?: Supplier; onSaved: (supplier: Supplier) => void; onCancel: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim() || null;
    const trn = text("trn")?.replace(/\s/g, "") ?? null;
    if (trn && !/^\d{15}$/.test(trn)) return setError("A UAE TRN has 15 digits.");
    const next: Supplier = { id: supplier?.id ?? crypto.randomUUID(), name: text("name") ?? "", trn, phone: text("phone"), email: text("email"), note: text("note"), archived: supplier?.archived ?? false };
    if (!next.name) return setError("Enter the supplier's name.");
    setBusy(true);
    const result = await saveSupplier(next);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    onSaved(next);
  }

  const title = supplier ? "Edit supplier" : "Add supplier";
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}>
      <form className="modal" onSubmit={submit} aria-label={title}>
        <div className="modal-header"><div><div className="panel-title">{title}</div><div className="panel-subtitle">Who you buy from</div></div><button type="button" className="button icon-only" onClick={onCancel} aria-label="Close"><X size={16} weight="bold" /></button></div>
        <div className="modal-body"><div className="form-grid">
          <div className="field full-span"><label htmlFor="supplier-name">Name</label><input className="input" id="supplier-name" name="name" required maxLength={80} defaultValue={supplier?.name} autoFocus /></div>
          <div className="field"><label htmlFor="supplier-trn">TRN (optional)</label><input className="input" id="supplier-trn" name="trn" inputMode="numeric" maxLength={20} defaultValue={supplier?.trn ?? ""} /></div>
          <div className="field"><label htmlFor="supplier-phone">Phone</label><input className="input" id="supplier-phone" name="phone" maxLength={30} defaultValue={supplier?.phone ?? ""} /></div>
          <div className="field full-span"><label htmlFor="supplier-email">Email</label><input className="input" id="supplier-email" name="email" type="email" maxLength={120} defaultValue={supplier?.email ?? ""} /></div>
          <div className="field full-span"><label htmlFor="supplier-note">Note</label><textarea className="textarea" id="supplier-note" name="note" maxLength={300} defaultValue={supplier?.note ?? ""} /></div>
        </div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div>
        <div className="modal-footer"><button type="button" className="button" onClick={onCancel}>Cancel</button><button className="button primary" type="submit" disabled={busy}>Save supplier</button></div>
      </form>
    </div>
  );
}
