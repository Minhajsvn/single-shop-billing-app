"use client";

import { useState } from "react";

/** A value with a Copy button (Stripe ids on the admin shop page). */
export function CopyText({ value }: { value: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-slate-400">—</span>;

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
    <span className="inline-flex max-w-full items-center gap-2">
      <code className="truncate rounded bg-slate-100 px-1.5 py-0.5 text-xs">{value}</code>
      <button type="button" onClick={copy} className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100">
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
