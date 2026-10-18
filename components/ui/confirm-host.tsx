"use client";

import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent } from "react";
import { answerConfirm, getConfirms, getServerConfirms, subscribeConfirms } from "@/lib/ui/confirm-store";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])";

/** Shows queued in-app confirmations (replaces window.confirm): focus trapped, Escape cancels, focus returns. */
export function ConfirmHost() {
  const requests = useSyncExternalStore(subscribeConfirms, getConfirms, getServerConfirms);
  const request = requests[0];
  const dialog = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!request) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Destructive actions start on Cancel so Enter never discards anything by accident.
    (request.destructive ? cancelButton : confirmButton).current?.focus();
    return () => { opener?.focus(); };
  }, [request]);

  if (!request) return null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      answerConfirm(request.id, false);
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div className="modal-backdrop confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) answerConfirm(request.id, false); }}>
      <div ref={dialog} className="modal confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body" onKeyDown={onKeyDown}>
        <div className="modal-body">
          <h2 className="panel-title" id="confirm-title">{request.title}</h2>
          <p className="confirm-body" id="confirm-body">{request.body}</p>
        </div>
        <div className="modal-footer">
          <button ref={cancelButton} type="button" className="button" onClick={() => answerConfirm(request.id, false)}>Cancel</button>
          <button ref={confirmButton} type="button" className={`button ${request.destructive ? "danger" : "primary"}`} onClick={() => answerConfirm(request.id, true)}>{request.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
