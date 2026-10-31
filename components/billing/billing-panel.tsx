"use client";

import { CreditCard } from "@/components/icons";
import { useEffect, useRef, useState } from "react";
import { fixesInPortal } from "@/components/billing/lifecycle-banner";
import { useEntitlement } from "@/components/billing/use-entitlement";
import { billingSummary, dubaiDate, isGranted, priceLine } from "@/lib/billing/lifecycle-view";
import { loadRazorpayCheckout, openRazorpayCheckout } from "@/lib/billing/razorpay-checkout";
import { refreshEntitlements, refreshSnapshot, useShopContext } from "@/lib/demo-store";
import { requestConfirm } from "@/lib/ui/confirm-store";
import { toast } from "@/lib/ui/toast-store";

type Interval = "month" | "year";
type Kind = "razorpay" | "pretend" | "none";
type Busy = "checkout" | "update-card" | "cancel";
type Checkout = { kind: "razorpay"; subscriptionId: string; keyId: string } | { kind: "redirect"; url: string };

const NOT_SET_UP = "Billing is not set up yet.";
const POLL_EVERY_MS = 3_000;
const POLL_FOR_MS = 60_000;

export function BillingPanel({ overTillLimit, onShowTills }: { overTillLimit: boolean; onShowTills: () => void }) {
  const { mode, business } = useShopContext();
  const { e, now, role } = useEntitlement();
  const hosted = mode === "hosted";
  const [kind, setKind] = useState<Kind | null>(null);
  const [interval, setInterval] = useState<Interval>("month");
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState("");
  // The poll after a payment compares against the latest entitlements without restarting on every render.
  const seen = useRef(e);
  const poll = useRef<ReturnType<typeof globalThis.setInterval> | null>(null);
  useEffect(() => { seen.current = e; }, [e]);

  useEffect(() => {
    if (!hosted) return;
    let alive = true;
    fetch("/api/v1/billing/provider", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { kind?: Kind } | null) => { if (alive) setKind(body?.kind ?? "none"); })
      .catch(() => { if (alive) setKind("none"); });
    return () => { alive = false; };
  }, [hosted]);

  useEffect(() => () => { if (poll.current) globalThis.clearInterval(poll.current); }, []);

  // Coming back from the pretend pages: re-read the subscription, then drop the marker from the address.
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

  const state = () => `${seen.current.status}|${seen.current.hasPaymentMethod}|${seen.current.planId}`;

  /** The webhook lands a moment after the payment window closes: check every 3 s, for up to a minute, until the plan changes. */
  function waitForPlanChange() {
    toast("Payment received, updating…");
    if (poll.current) globalThis.clearInterval(poll.current);
    const before = state();
    const startedAt = Date.now();
    poll.current = globalThis.setInterval(() => {
      void refreshEntitlements().then(() => {
        if (state() !== before || Date.now() - startedAt >= POLL_FOR_MS) {
          if (poll.current) globalThis.clearInterval(poll.current);
          poll.current = null;
          if (state() !== before) void refreshSnapshot();
        }
      });
    }, POLL_EVERY_MS);
  }

  function fail(status: number, body: { error?: string } | null, fallback: string) {
    if (status === 503) setError(NOT_SET_UP);
    else if (status === 401 || status === 403) setError("Only the shop owner can manage billing.");
    else setError(body?.error ?? fallback);
  }

  async function post(path: Busy, init?: RequestInit) {
    const response = await fetch(`/api/v1/billing/${path}`, { method: "POST", ...init });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    return { response, body };
  }

  async function choosePlan() {
    setBusy("checkout");
    setError("");
    try {
      const { response, body } = await post("checkout", { headers: { "content-type": "application/json" }, body: JSON.stringify({ interval }) });
      const result = body as (Checkout & { error?: string }) | null;
      if (response.ok && result?.kind === "razorpay") {
        await loadRazorpayCheckout();
        openRazorpayCheckout({ keyId: result.keyId, subscriptionId: result.subscriptionId, onPaid: () => { setBusy(null); waitForPlanChange(); }, onDismiss: () => setBusy(null) });
        return;
      }
      if (response.ok && result?.kind === "redirect") {
        window.location.assign(result.url);
        return;
      }
      fail(response.status, result, "Billing could not be opened. Try again.");
    } catch {
      setError("Billing could not be opened. Check the connection and try again.");
    }
    setBusy(null);
  }

  async function updateCard() {
    setBusy("update-card");
    setError("");
    try {
      const { response, body } = await post("update-card");
      const url = typeof body?.url === "string" ? body.url : null;
      if (response.ok && url) {
        // Same tab: a new tab opened after an await can be silently blocked (Safari).
        window.location.assign(url);
        return;
      } else fail(response.status, body as { error?: string } | null, "Billing could not be opened. Try again.");
    } catch {
      setError("Billing could not be opened. Check the connection and try again.");
    }
    setBusy(null);
  }

  async function cancel() {
    const trialCard = e.status === "trialing";
    const shop = business?.legalName ?? "this shop";
    const end = dubaiDate(trialCard ? (e.trialEndsAt ?? e.accessEndsAt) : e.currentPeriodEnd, true);
    const ok = await requestConfirm({
      title: `Cancel the subscription for ${shop}?`,
      body: trialCard
        ? `Your card is removed; the trial continues until ${end}.`
        : `Starter stays until ${end}. After that the shop becomes read-only.`,
      confirmLabel: "Cancel subscription",
      destructive: true,
    });
    if (!ok) return;
    setBusy("cancel");
    setError("");
    try {
      const { response, body } = await post("cancel");
      if (response.ok) {
        await Promise.all([refreshEntitlements(), refreshSnapshot()]);
        toast(typeof body?.cancelAt === "string" ? `Subscription ends on ${dubaiDate(body.cancelAt, true)}` : "Card removed");
      } else fail(response.status, body as { error?: string } | null, "The subscription could not be cancelled. Try again.");
    } catch {
      setError("The subscription could not be cancelled. Check the connection and try again.");
    }
    setBusy(null);
  }

  const unavailable = !hosted || kind === "none";
  const hasCard = fixesInPortal(e);
  const granted = isGranted(e, now);
  const canCancel = hasCard && !e.cancelAt && (e.status === "active" || e.status === "past_due" || (e.status === "trialing" && e.hasPaymentMethod));

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
            {granted ? null : (<>
            <div role="group" aria-label="Billing period" style={{ display: "flex", gap: 8 }}>
              <button type="button" className={`button ${interval === "month" ? "primary" : ""}`} aria-pressed={interval === "month"} onClick={() => setInterval("month")}>Monthly</button>
              <button type="button" className={`button ${interval === "year" ? "primary" : ""}`} aria-pressed={interval === "year"} onClick={() => setInterval("year")}>Annual</button>
            </div>
            <div style={{ fontWeight: 600 }}>{priceLine(interval)}</div>
            </>)}
            {overTillLimit ? (
              <p style={{ margin: 0 }}>Your plan allows fewer tills than are active. <button type="button" className="button" onClick={onShowTills}>Choose which till stays</button></p>
            ) : null}
            {role === "owner" && !granted ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {hasCard ? (
                  <>
                    <button type="button" className="button primary" onClick={() => void updateCard()} disabled={busy !== null}><CreditCard size={14} weight="bold" />{busy === "update-card" ? "Opening…" : "Update card"}</button>
                    {canCancel ? <button type="button" className="button" onClick={() => void cancel()} disabled={busy !== null}>{busy === "cancel" ? "Cancelling…" : "Cancel subscription"}</button> : null}
                  </>
                ) : (
                  <button type="button" className="button primary" onClick={() => void choosePlan()} disabled={busy !== null}>{busy === "checkout" ? "Opening…" : "Choose a plan"}</button>
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
