"use client";

import { useEffect, useState } from "react";

// One sale shown three times: queued while offline, waiting to send, and synced. The middle row works.

function SaleRow({ state, onSync }: { state: "queued" | "ready" | "synced"; onSync?: () => void }) {
  const label = state === "queued" ? "Offline · waiting" : state === "ready" ? "Back online" : "Synced";
  return (
    <div className={`sale-row is-${state}`} data-ui>
      <span className="sale-inv">INV-0143</span>
      <span className="sale-who">Walk-in customer</span>
      <span className="sale-time">18:51</span>
      <span className="sale-amt">AED 55.00</span>
      <span className="sale-state">{label}</span>
      {state === "ready" && onSync ? (
        <button type="button" className="sale-action" onClick={onSync}>Sync now</button>
      ) : (
        <span className="sale-action-space" aria-hidden="true" />
      )}
    </div>
  );
}

export function SyncRows() {
  const [middle, setMiddle] = useState<"ready" | "synced">("ready");

  useEffect(() => {
    if (middle !== "synced") return;
    const timer = window.setTimeout(() => setMiddle("ready"), 2600);
    return () => window.clearTimeout(timer);
  }, [middle]);

  return (
    <ol className="sync-rows">
      <li><span className="sync-word">Saved</span><SaleRow state="queued" /></li>
      <li><span className="sync-word">Sending</span><SaleRow state={middle} onSync={() => setMiddle("synced")} /></li>
      <li><span className="sync-word">Done</span><SaleRow state="synced" /></li>
    </ol>
  );
}
