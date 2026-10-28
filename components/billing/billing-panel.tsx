"use client";

import { CreditCard } from "@/components/icons";
import { useEffect, useState } from "react";
import { fixesInPortal } from "@/components/billing/lifecycle-banner";
import { useEntitlement } from "@/components/billing/use-entitlement";
import { billingSummary } from "@/lib/billing/lifecycle-view";
import { PLANS } from "@/lib/billing/plans";
import { refreshEntitlements, refreshSnapshot, useShopContext } from "@/lib/demo-store";
import { toast } from "@/lib/ui/toast-store";

type Interval = "month" | "year";
type Kind = "stripe" | "pretend" | "none";

const NOT_SET_UP = "Billing is not set up yet.";
const money = (minor: number) => (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Price shown to the owner: the net price, the 5% VAT and the total, from the plan table. */
function priceLines(interval: Interval) {
  const starter = PLANS.starter;
  const net = (interval === "year" ? starter.annualPriceMinor : starter.monthlyPriceMinor)?.AED ?? 0;
  const vat = Math.round(net * 0.05);
  return { net, vat, total: net + vat };
}

export function BillingPanel({ overTillLimit, onShowTills }: { overTillLimit: boolean; onShowTills: () => void }) {
  const { mode } = useShopContext();
  const { e, now, role } = useEntitlement();
  const hosted = mode === "hosted";
  const [kind, setKind] = useState<Kind | null>(null);
  const [interval, setInterval] = useState<Interval>("month");
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hosted) return;
    let alive = true;
    fetch("/api/v1/billing/provider", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { kind?: Kind } | null) => { if (alive) setKind(body?.kind ?? "none"); })
      .catch(() => { if (alive) setKind("none"); });
    return () => { alive = false; };
  }, [hosted]);

  // Coming back from checkout or the portal: re-read the subscription, then drop the marker from the address.
  useEffect(() => {
    if (!hosted) return;
    const search = new URLSearchParams(window.location.search);
    const checkout = search.get("checkout");
    const portal = search.get("portal");
    if (!checkout && !portal) return;
    if (checkout === "success" || portal === "return") {
      void Promise.all([refreshEntitlements(), refreshSnapshot()]).then(() => {
        if (checkout === "success") toast("Payment received");
      });
    }
    search.delete("checkout");
    search.delete("portal");
    const query = search.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [hosted]);

  async function go(path: "checkout" | "portal") {
    setBusy(path);
    setError("");
    try {
      const response = await fetch(`/api/v1/billing/${path}`, {
        method: "POST",
        ...(path === "checkout" ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ interval }) } : {}),
      });
      const body = await response.json().catch(() => null) as { url?: string; error?: string } | null;
      if (response.ok && body?.url) {
        window.location.assign(body.url);
        return;
      }
      if (response.status === 503) setError(NOT_SET_UP);
      else if (response.status === 401 || response.status === 403) setError("Only the shop owner can manage billing.");
      else if (response.status === 409 && path === "checkout") setError("This shop already has a subscription. Use Manage billing to change it.");
      else if (response.status === 409) setError("There is no billing account yet. Choose a plan first.");
      else setError(body?.error ?? "Billing could not be opened. Try again.");
    } catch {
      setError("Billing could not be opened. Check the connection and try again.");
    }
    setBusy(null);
  }

  const prices = priceLines(interval);
  const unavailable = !hosted || kind === "none";
  const manage = fixesInPortal(e);

  return (
    <section className="panel">
      <div className="panel-header">
        <div><div className="panel-title">Billing</div><div className="panel-subtitle">Your plan, price and payment method</div></div>
        {kind === "pretend" ? <span className="badge yellow">Test billing — no real charges</span> : null}
      </div>
      <div className="panel-body" style={{ display: "grid", gap: 14 }}>
        {unavailable ? <p>{NOT_SET_UP}</p> : (
          <>
            <p style={{ margin: 0, fontWeight: 600 }}>{billingSummary(e, now)}</p>
            <div role="group" aria-label="Billing period" style={{ display: "flex", gap: 8 }}>
              <button type="button" className={`button ${interval === "month" ? "primary" : ""}`} aria-pressed={interval === "month"} onClick={() => setInterval("month")}>Monthly</button>
              <button type="button" className={`button ${interval === "year" ? "primary" : ""}`} aria-pressed={interval === "year"} onClick={() => setInterval("year")}>Annual</button>
            </div>
            <div>
              <div style={{ fontWeight: 600 }}>
                {interval === "year" ? `Starter · AED ${money(prices.net).replace(/\.00$/, "")} / year (2 months free)` : `Starter · AED ${money(prices.net)} / month`}
              </div>
              <div className="panel-subtitle">
                {`AED ${money(prices.net)} + ${money(prices.vat)} VAT (5%) = AED ${money(prices.total)} ${interval === "year" ? "a year" : "a month"}`}
              </div>
            </div>
            {overTillLimit ? (
              <p style={{ margin: 0 }}>Your plan allows fewer tills than are active. <button type="button" className="button" onClick={onShowTills}>Choose which till stays</button></p>
            ) : null}
            {role === "owner" ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {manage ? (
                  <button type="button" className="button primary" onClick={() => void go("portal")} disabled={busy !== null}><CreditCard size={14} weight="bold" />{busy === "portal" ? "Opening…" : "Manage billing"}</button>
                ) : (
                  <button type="button" className="button primary" onClick={() => void go("checkout")} disabled={busy !== null}>{busy === "checkout" ? "Opening…" : "Choose a plan"}</button>
                )}
              </div>
            ) : null}
            {error ? <p className="form-error" role="alert" style={{ margin: 0 }}>{error}</p> : null}
          </>
        )}
      </div>
    </section>
  );
}
