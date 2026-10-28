"use client";

import { CreditCard, Info, WarningCircle } from "@/components/icons";
import Link from "next/link";
import { useState } from "react";
import { useEntitlement } from "@/components/billing/use-entitlement";
import type { Entitlements } from "@/lib/billing/entitlements";
import { bannerFor } from "@/lib/billing/lifecycle-view";

export const CHOOSE_PLAN_HREF = "/settings?tab=billing";

/** Opens the billing portal (owners only; the route refuses anyone else). */
export function UpdateCardButton({ className = "button" }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function open() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/billing/portal", { method: "POST" });
      const body = await response.json().catch(() => null) as { url?: string; error?: string } | null;
      if (response.ok && body?.url) {
        window.location.assign(body.url);
        return;
      }
      setError(body?.error ?? "Billing could not be opened. Try again.");
    } catch {
      setError("Billing could not be opened. Check the connection and try again.");
    }
    setBusy(false);
  }

  return (
    <>
      <button type="button" className={className} onClick={() => void open()} disabled={busy}><CreditCard size={14} weight="bold" />{busy ? "Opening…" : "Update card"}</button>
      {error ? <span className="lifecycle-banner-error" role="alert">{error}</span> : null}
    </>
  );
}

/** Ledger ruling: an owner with a card on file whose subscription is not canceled fixes it in the portal, not checkout. */
export function fixesInPortal(e: Entitlements): boolean {
  return e.hasPaymentMethod && e.status !== null && e.status !== "canceled";
}

/** One banner slot under the top bar: read-only > payment failed > offline too long > trial ending. */
export function LifecycleBanner() {
  const { e, stale, role, now } = useEntitlement();
  const found = bannerFor({ e, stale, role, now });
  if (!found) return null;
  const banner = found.action === "choose_plan" && fixesInPortal(e) ? { ...found, action: "update_card" as const } : found;
  const owner = role === "owner";
  const Icon = banner.tone === "grey" ? Info : WarningCircle;
  // The trial line reads "Pro trial · N days left · Choose a plan": its last part is the link itself.
  const linkSuffix = " · Choose a plan";
  const inlineLink = banner.action === "choose_plan" && banner.text.endsWith(linkSuffix);
  const text = inlineLink ? banner.text.slice(0, -linkSuffix.length) : banner.text;

  return (
    <div className={`lifecycle-banner ${banner.tone}`} role={banner.tone === "red" ? "alert" : "status"}>
      <Icon size={16} weight="bold" className="lifecycle-banner-icon" aria-hidden />
      <span className="lifecycle-banner-text">
        {text}
        {inlineLink && owner ? <> · <Link href={CHOOSE_PLAN_HREF}>Choose a plan</Link></> : null}
        {inlineLink && !owner ? linkSuffix : null}
      </span>
      {owner && banner.action === "update_card" ? <span className="lifecycle-banner-actions"><UpdateCardButton /></span> : null}
      {owner && banner.action === "choose_plan" && !inlineLink ? <span className="lifecycle-banner-actions"><Link className="button" href={CHOOSE_PLAN_HREF}>Choose a plan</Link></span> : null}
    </div>
  );
}
