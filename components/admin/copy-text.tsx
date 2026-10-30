"use client";

import { useState } from "react";

/** A value with a Copy button (Stripe ids on the admin shop page). */
export function CopyText({ value }: { value: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="admin-muted">—</span>;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span className="admin-copy">
      <code className="admin-code" title={value}>{value}</code>
      <button type="button" onClick={copy} className="button">{copied ? "Copied" : "Copy"}</button>
    </span>
  );
}
