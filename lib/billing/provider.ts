import type { ProviderSubscription } from "./billing-check.ts";
import { subscriptionSnapshot } from "./razorpay-events.ts";
import { isMissing, razorpayErrorDescription, razorpayRequest, type FetchLike } from "./razorpay-api.ts";
import type { BillingInterval } from "./events.ts";
import { hasPlaceholders, SITE_INFO, type SiteInfo } from "../site-info.ts";

export type { ProviderSubscription } from "./billing-check.ts";

export type BillingProviderKind = "razorpay" | "pretend" | "none";

export type CheckoutInput = {
  businessId: string;
  interval: BillingInterval;
  trialEndsAt: string | null;
  origin: string;
};

/** Razorpay opens its own checkout in the page (subscriptionId + keyId); the pretend provider redirects. */
export type CheckoutResult =
  | { kind: "razorpay"; subscriptionId: string; keyId: string }
  | { kind: "redirect"; url: string };

export type CancelInput = { businessId: string; subscriptionId: string; atPeriodEnd: boolean };

export type BillingProvider = {
  kind: BillingProviderKind;
  startCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  /** A page where the owner can change the card on this subscription. */
  updateCardUrl(subscriptionId: string, origin: string): Promise<string>;
  /** Idempotent: a subscription that is already cancelled counts as cancelled. */
  cancel(input: CancelInput): Promise<void>;
  /** The provider's view of a subscription for the billing check; null when the provider has no such subscription. */
  getSubscription(id: string): Promise<ProviderSubscription | null>;
};

type Env = Record<string, string | undefined>;

export const BILLING_NOT_SET_UP = "Billing is not set up yet.";

const RAZORPAY_VARIABLES = [
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "RAZORPAY_PLAN_STARTER_MONTHLY",
  "RAZORPAY_PLAN_STARTER_ANNUAL",
] as const;

export function razorpayConfigured(env: Env = process.env): boolean {
  return RAZORPAY_VARIABLES.every((name) => Boolean(env[name]));
}

/** True when at least one RAZORPAY_ variable is set: a partial config is a broken Razorpay setup, not "no Razorpay". */
function anyRazorpayVariable(env: Env): boolean {
  return Object.keys(env).some((name) => name.startsWith("RAZORPAY_") && Boolean(env[name]));
}

/** A subscription starting later than this is accepted as a trial (the first charge is at start_at). */
export const MIN_START_LEAD_MS = 24 * 60 * 60 * 1000;

/** total_count is required by Razorpay; these give a 10-year runway (the docs state no per-plan maximum). */
export const RAZORPAY_MAX_COUNT: Record<BillingInterval, number> = { month: 120, year: 10 };

/** The body for POST /v1/subscriptions. start_at (unix seconds) carries a running trial's end, when it is far enough away. */
export function subscriptionCreateBody(
  env: Env,
  input: Pick<CheckoutInput, "businessId" | "interval" | "trialEndsAt">,
  now: Date = new Date(),
): Record<string, unknown> {
  const plan = input.interval === "year" ? env.RAZORPAY_PLAN_STARTER_ANNUAL : env.RAZORPAY_PLAN_STARTER_MONTHLY;
  if (!plan) throw new Error(BILLING_NOT_SET_UP);
  const trialEnd = input.trialEndsAt ? Date.parse(input.trialEndsAt) : NaN;
  const delayed = Number.isFinite(trialEnd) && trialEnd - now.getTime() > MIN_START_LEAD_MS;
  return {
    plan_id: plan,
    total_count: RAZORPAY_MAX_COUNT[input.interval],
    customer_notify: 1,
    notes: { business_id: input.businessId, interval: input.interval },
    ...(delayed ? { start_at: Math.floor(trialEnd / 1000) } : {}),
  };
}

/** Razorpay answers a second cancel of a finished subscription with 400 "not cancellable in <status> status". */
const ALREADY_ENDED = /not cancellable in (cancelled|completed|expired) status/i;

export function razorpayProvider(env: Env, fetchImpl?: FetchLike): BillingProvider {
  const request = (method: "GET" | "POST", path: string, body?: object) => razorpayRequest(env, method, path, body, fetchImpl);
  const fail = (what: string, result: { status: number; json: unknown }) =>
    new Error(`Razorpay ${what} failed (${result.status}): ${razorpayErrorDescription(result.json)}`);
  return {
    kind: "razorpay",
    async startCheckout(input) {
      const result = await request("POST", "/subscriptions", subscriptionCreateBody(env, input));
      const id = (result.json as { id?: unknown } | null)?.id;
      if (result.status !== 200 || typeof id !== "string") throw fail("subscription create", result);
      return { kind: "razorpay", subscriptionId: id, keyId: env.RAZORPAY_KEY_ID as string };
    },
    async updateCardUrl(subscriptionId) {
      const result = await request("GET", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
      const url = (result.json as { short_url?: unknown } | null)?.short_url;
      if (result.status !== 200 || typeof url !== "string" || url === "") throw fail("subscription fetch", result);
      return url;
    },
    async cancel(input) {
      const result = await request("POST", `/subscriptions/${encodeURIComponent(input.subscriptionId)}/cancel`, {
        cancel_at_cycle_end: input.atPeriodEnd ? 1 : 0,
      });
      if (result.status === 200) return;
      if (result.status === 400 && ALREADY_ENDED.test(razorpayErrorDescription(result.json))) return;
      throw fail("cancel", result);
    },
    async getSubscription(id) {
      const result = await request("GET", `/subscriptions/${encodeURIComponent(id)}`);
      if (isMissing(result)) return null;
      const entity = result.json;
      if (result.status !== 200 || entity === null || typeof entity !== "object") throw fail("subscription fetch", result);
      return subscriptionSnapshot(entity as Record<string, unknown>);
    },
  };
}

/** Subscription ids the pretend provider makes (lib/billing/pretend-events.ts): pretend_sub_<business id>. */
const PRETEND_SUBSCRIPTION_PREFIX = "pretend_sub_";

/** Our statuses in Razorpay's words, so the check's status mapping (ourStatusFor) agrees end to end locally. */
const PRETEND_STATUS: Record<string, string> = { trialing: "authenticated", past_due: "pending", canceled: "cancelled" };

/**
 * The pretend provider's view of a subscription is our own row, so a local check agrees end to end. An id it did not
 * make (for example a Razorpay-like sub_… set by hand in a test) does not exist there, which the check flags.
 */
async function pretendSubscription(id: string): Promise<ProviderSubscription | null> {
  if (!id.startsWith(PRETEND_SUBSCRIPTION_PREFIX)) return null;
  const { createAdminClient } = await import("../supabase/admin.ts");
  const { data, error } = await createAdminClient()
    .from("subscriptions")
    .select("status, current_period_end, cancel_at, trial_ends_at")
    .eq("billing_subscription_id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    exists: true,
    status: PRETEND_STATUS[data.status as string] ?? (data.status as string),
    currentPeriodEnd: data.current_period_end as string | null,
    cancelAt: data.cancel_at as string | null,
    trialEnd: data.trial_ends_at as string | null,
  };
}

const pretendProvider: BillingProvider = {
  kind: "pretend",
  async startCheckout(input) {
    return { kind: "redirect", url: `/billing/pretend?interval=${encodeURIComponent(input.interval)}` };
  },
  async updateCardUrl() {
    return "/billing/pretend/portal";
  },
  async cancel(input) {
    // At period end the route records cancel_at and the pretend "renew" action later ends the subscription.
    if (input.atPeriodEnd) return;
    const [{ applyBillingEvent }, { pretendEvent }] = await Promise.all([import("./apply-event.ts"), import("./pretend-events.ts")]);
    const events = pretendEvent("remove_trial_card", { businessId: input.businessId, interval: "month", now: new Date(), trialEndsAt: null });
    for (const event of events) await applyBillingEvent(event);
  },
  getSubscription: pretendSubscription,
};

const noProvider: BillingProvider = {
  kind: "none",
  async startCheckout() {
    throw new Error(BILLING_NOT_SET_UP);
  },
  async updateCardUrl() {
    throw new Error(BILLING_NOT_SET_UP);
  },
  async cancel() {
    throw new Error(BILLING_NOT_SET_UP);
  },
  async getSubscription() {
    throw new Error(BILLING_NOT_SET_UP);
  },
};

/**
 * Razorpay when fully configured and the business details are filled in; the pretend provider only outside production
 * and with no RAZORPAY_ variable set; otherwise none (a partial config, or placeholder details, is "billing not set up"
 * in every NODE_ENV).
 */
export function billingProvider(env: Env = process.env, info: SiteInfo = SITE_INFO): BillingProvider {
  if (razorpayConfigured(env)) return hasPlaceholders(info) ? noProvider : razorpayProvider(env);
  if (env.NODE_ENV !== "production" && !anyRazorpayVariable(env)) return pretendProvider;
  return noProvider;
}
