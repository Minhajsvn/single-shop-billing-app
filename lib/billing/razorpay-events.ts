import { createHmac, timingSafeEqual } from "node:crypto";
import type { ProviderSubscription } from "./billing-check.ts";
import type { BillingEvent, BillingInterval } from "./events.ts";

type Obj = Record<string, unknown>;

export type RazorpayWebhook = {
  event: string;
  created_at: number;
  payload: { subscription?: { entity: Obj }; payment?: { entity: Obj } };
};

const asObj = (value: unknown): Obj | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : null;

const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

const isoFromSeconds = (value: unknown): string | null => {
  const seconds = num(value);
  return seconds === null ? null : new Date(seconds * 1000).toISOString();
};

const toInterval = (value: unknown): BillingInterval | null => (value === "month" || value === "year" ? value : null);

/** Verifies X-Razorpay-Signature: a hex HMAC-SHA256 of the raw body, compared in constant time. */
export function verifyRazorpaySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"));
  const given = Buffer.from(signature);
  // timingSafeEqual throws on unequal lengths, so a length mismatch is a plain false.
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function fromSubscription(entity: Obj) {
  const notes = asObj(entity.notes);
  return {
    businessId: str(notes?.business_id),
    customerId: str(entity.customer_id),
    subscriptionId: str(entity.id),
    trialEnd: isoFromSeconds(entity.start_at),
    currentPeriodEnd: isoFromSeconds(entity.current_end),
    cancelAt: null,
    interval: toInterval(notes?.interval),
  };
}

/**
 * The billing check's view of a retrieved Razorpay subscription. Razorpay has no trial status: a card-saved
 * trial is an `authenticated` subscription whose start_at is the first charge, so that is the trial end.
 */
export function subscriptionSnapshot(entity: Obj): ProviderSubscription {
  const sub = fromSubscription(asObj(entity) ?? {});
  const status = str(asObj(entity)?.status);
  return {
    exists: true,
    status,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAt: null,
    trialEnd: status === "authenticated" ? sub.trialEnd : null,
  };
}

/** Turns a verified Razorpay webhook into a BillingEvent, or null when the event is not one we act on. */
export function normalizeRazorpayEvent(eventId: string, body: RazorpayWebhook): BillingEvent | null {
  const entity = asObj(body?.payload?.subscription?.entity);
  const createdAt = num(body?.created_at);
  const created = isoFromSeconds(createdAt);
  if (!entity || createdAt === null || !created || !str(eventId)) return null;
  const base = { id: eventId, created, ...fromSubscription(entity) };
  // A trial card is an authenticated subscription whose first charge (start_at) is still in the future.
  const startAt = num(entity.start_at);
  const startsLater = startAt !== null && startAt > createdAt;

  switch (body.event) {
    case "subscription.authenticated":
      return startsLater ? { ...base, kind: "checkout_completed", status: "trialing" } : null;
    case "subscription.activated":
      return { ...base, kind: "checkout_completed", status: "active" };
    case "subscription.charged":
      return { ...base, kind: "invoice_paid", status: "active" };
    case "subscription.pending":
    case "subscription.halted":
      return { ...base, kind: "payment_failed", status: "past_due" };
    case "subscription.cancelled":
      // Cancelled before the first charge while the trial still runs: only the card goes, not the shop.
      return {
        ...base,
        kind: num(entity.paid_count) === 0 && startsLater ? "trial_card_removed" : "subscription_deleted",
        status: "canceled",
      };
    case "subscription.completed":
    case "subscription.expired":
      return { ...base, kind: "subscription_deleted", status: "canceled" };
    default:
      return null;
  }
}
