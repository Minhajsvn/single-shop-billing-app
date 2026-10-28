"use client";

import { CheckCircle, Info, X } from "@/components/icons";
import { useSyncExternalStore } from "react";
import { dismissToast, getServerToasts, getToasts, subscribeToasts } from "@/lib/ui/toast-store";

/** Short confirmations of what just happened. Announced politely; each dismisses itself after 4 seconds. */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getServerToasts);
  return (
    <div className="toaster" aria-live="polite" aria-atomic="false">
      {toasts.map((item) => (
        <div className={`toast ${item.tone ?? "ok"}`} key={item.id} role="status">
          {item.tone === "info" ? <Info size={16} weight="fill" /> : <CheckCircle size={16} weight="fill" />}
          <span>{item.message}</span>
          <button type="button" className="toast-close" onClick={() => dismissToast(item.id)} aria-label="Dismiss"><X size={13} weight="bold" /></button>
        </div>
      ))}
    </div>
  );
}
