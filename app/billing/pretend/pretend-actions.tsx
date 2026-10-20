"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PretendAction } from "@/lib/billing/pretend-events";

/** No action: just leave (checkout=cancel). */
export type PretendButton = { action?: PretendAction; label: string; tone?: "primary" | "plain"; returnTo: "success" | "cancel" | "stay" };

/** Posts one pretend action, then returns to the billing tab (or stays to show a message). */
export function PretendActions({ buttons, interval }: { buttons: PretendButton[]; interval: "month" | "year" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function run(button: PretendButton) {
    if (!button.action) {
      router.push(`/settings?tab=billing&checkout=${button.returnTo}`);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/billing/pretend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: button.action, interval }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setMessage(body?.error ?? "That did not work. Try again.");
        return;
      }
      if (button.action === "decline") {
        setMessage("Card declined. Nothing was charged.");
        return;
      }
      if (button.returnTo === "stay") {
        setMessage("Done.");
        return;
      }
      router.push(`/settings?tab=billing&checkout=${button.returnTo}`);
    } catch {
      setMessage("That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {buttons.map((button) => (
        <button
          key={button.label}
          type="button"
          disabled={busy}
          onClick={() => run(button)}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #888",
            background: button.tone === "primary" ? "#111" : "transparent",
            color: button.tone === "primary" ? "#fff" : "inherit",
            cursor: busy ? "default" : "pointer",
          }}
        >
          {button.label}
        </button>
      ))}
      <p role="status" aria-live="polite" style={{ minHeight: 20, margin: 0 }}>{message}</p>
    </div>
  );
}
