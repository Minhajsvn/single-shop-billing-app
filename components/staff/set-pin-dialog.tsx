"use client";

import { X } from "@/components/icons";
import { useState } from "react";
import { hashPin } from "@/lib/staff/pin";
import { PinPad } from "./pin-pad";

/**
 * Enter a new PIN twice; it is hashed on this device and sent to `url` (PUT). Used for "Your PIN" and for
 * "Set PIN at this till", where the owner hands the till to the staff member.
 */
export function SetPinDialog({ title, url, onDone, onCancel }: { title: string; url: string; onDone: () => void; onCancel: () => void }) {
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function enter(pin: string) {
    if (first === null) {
      setFirst(pin);
      setError("");
      return true;
    }
    if (pin !== first) {
      setFirst(null);
      setError("The two PINs did not match. Start again.");
      return false;
    }
    setBusy(true);
    try {
      const response = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(await hashPin(pin)) });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setFirst(null);
        setError(body.error ?? "The PIN could not be saved. Try again.");
        return false;
      }
      onDone();
      return true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}>
      <div className="modal approval-dialog" role="dialog" aria-modal="true" aria-labelledby="set-pin-title">
        <div className="modal-header">
          <div><div className="panel-title" id="set-pin-title">{title}</div><div className="panel-subtitle">{first === null ? "Enter a 4-digit PIN" : "Enter the same PIN again"}</div></div>
          <button type="button" className="button icon-only" onClick={onCancel} aria-label="Cancel"><X size={16} weight="bold" /></button>
        </div>
        <div className="modal-body">
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <PinPad key={first === null ? "first" : "second"} label={title} onSubmit={enter} busy={busy} />
        </div>
      </div>
    </div>
  );
}
