import Stripe from "stripe";
import type { ProviderSubscription } from "./billing-check.ts";

export type BillingEventKind =
  | "checkout_completed"
  | "subscription_changed"
  | "subscription_deleted"
  | "invoice_paid"
  | "payment_failed";

export type BillingInterval = "month" | "year";

/** The JSON `public.apply_billing_event(p_event)` accepts. Dates are ISO strings. */
export type BillingEvent = {
  id: string;
  created: string;
  kind: BillingEventKind;
  businessId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  status: string | null;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  cancelAt: string | null;
  interval: BillingInterval | null;
};

export type StripeEventLike = { id: string; type: string; created: number; data: { object: unknown } };

type Obj = Record<string, unknown>;

const asObj = (value: unknown): Obj | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : null;

const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** A Stripe reference may be an id string or an expanded object with an id. */
const ref = (value: unknown): string | null => str(value) ?? str(asObj(value)?.id);

const isoFromSeconds = (value: unknown): string | null => {
  const seconds = num(value);
  return seconds === null ? null : new Date(seconds * 1000).toISOString();
};

const toInterval = (value: unknown): BillingInterval | null => (value === "month" || value === "year" ? value : null);

const listData = (value: unknown): Obj[] => {
  const data = asObj(value)?.data;
  return Array.isArray(data) ? data.map(asObj).filter((item): item is Obj => item !== null) : [];
};

const priceInterval = (item: Obj | undefined): BillingInterval | null =>
  toInterval(asObj(asObj(item?.price)?.recurring)?.interval);

const metadataBusinessId = (owner: unknown): string | null => str(asObj(asObj(owner)?.metadata)?.business_id);

function fromSubscription(sub: Obj) {
  const items = listData(sub.items);
  // From API 2025-03-31 the billing period lives on each subscription item.
  const periodEnds = items.map((item) => num(item.current_period_end)).filter((v): v is number => v !== null);
  const periodEnd = periodEnds.length ? Math.max(...periodEnds) : num(sub.current_period_end);
  const cancelAt = num(sub.cancel_at) ?? (sub.cancel_at_period_end === true ? periodEnd : null);
  return {
    businessId: metadataBusinessId(sub),
    customerId: ref(sub.customer),
    subscriptionId: str(sub.id),
    status: str(sub.status),
    trialEnd: isoFromSeconds(sub.trial_end),
    currentPeriodEnd: isoFromSeconds(periodEnd),
    cancelAt: isoFromSeconds(cancelAt),
    interval: priceInterval(items[0]),
  };
}

/**
 * The billing check's view of a retrieved Stripe subscription, read exactly as the webhook reads it
 * (period end from the subscription items, cancel_at_period_end as a cancel at the period end).
 */
export function subscriptionSnapshot(subscription: unknown): ProviderSubscription {
  const sub = fromSubscription(asObj(subscription) ?? {});
  return { exists: true, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, cancelAt: sub.cancelAt, trialEnd: sub.trialEnd };
}

function fromCheckoutSession(session: Obj) {
  const expanded = asObj(session.subscription);
  const sub = expanded ? fromSubscription(expanded) : null;
  const lineInterval = priceInterval(listData(session.line_items)[0]);
  // Without an expanded subscription the session itself says whether money was taken:
  // a trial checkout completes with nothing to pay.
  const status = sub?.status ?? (session.payment_status === "no_payment_required" ? "trialing" : "active");
  return {
    businessId: str(session.client_reference_id) ?? metadataBusinessId(session) ?? sub?.businessId ?? null,
    customerId: ref(session.customer),
    subscriptionId: ref(session.subscription),
    status,
    trialEnd: sub?.trialEnd ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    cancelAt: sub?.cancelAt ?? null,
    interval: lineInterval ?? sub?.interval ?? toInterval(asObj(session.metadata)?.interval),
  };
}

function fromInvoice(invoice: Obj) {
  const details = asObj(asObj(invoice.parent)?.subscription_details);
  const lines = listData(invoice.lines);
  const periodEnds = lines.map((line) => num(asObj(line.period)?.end)).filter((v): v is number => v !== null);
  return {
    businessId: str(asObj(details?.metadata)?.business_id),
    customerId: ref(invoice.customer),
    subscriptionId: ref(details?.subscription) ?? ref(invoice.subscription),
    status: null,
    trialEnd: null,
    currentPeriodEnd: isoFromSeconds(periodEnds.length ? Math.max(...periodEnds) : null),
    cancelAt: null,
    interval: null,
  };
}

/** Turns a verified Stripe event into a BillingEvent, or null when the event is not one we act on. */
export function normalizeStripeEvent(event: StripeEventLike): BillingEvent | null {
  const object = asObj(event.data?.object);
  const created = isoFromSeconds(event.created);
  if (!object || !created || !str(event.id)) return null;
  const base = { id: event.id, created };

  switch (event.type) {
    case "checkout.session.completed":
      if (object.mode !== "subscription") return null;
      return { ...base, kind: "checkout_completed", ...fromCheckoutSession(object) };
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return { ...base, kind: "subscription_changed", ...fromSubscription(object) };
    case "customer.subscription.deleted":
      return { ...base, kind: "subscription_deleted", ...fromSubscription(object) };
    case "invoice.paid":
      // Stripe's $0 trial-start invoice must not end the Pro trial (the SQL guards this too).
      if (num(object.amount_paid) === 0) return null;
      return { ...base, kind: "invoice_paid", ...fromInvoice(object) };
    case "invoice.payment_failed":
      return { ...base, kind: "payment_failed", ...fromInvoice(object) };
    default:
      return null;
  }
}

/** Verifies the Stripe-Signature header against the raw body; throws on a bad or stale signature. */
export function verifyStripeEvent(payload: string, signature: string, secret: string): StripeEventLike {
  return Stripe.webhooks.constructEvent(payload, signature, secret) as unknown as StripeEventLike;
}
