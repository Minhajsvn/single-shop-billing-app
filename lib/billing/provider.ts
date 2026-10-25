import Stripe from "stripe";
import type { ProviderSubscription } from "./billing-check.ts";
import { subscriptionSnapshot, type BillingInterval } from "./stripe-events.ts";

export type { ProviderSubscription } from "./billing-check.ts";

export type BillingProviderKind = "stripe" | "pretend" | "none";

export type CheckoutInput = {
  businessId: string;
  customerId: string | null;
  interval: BillingInterval;
  trialEndsAt: string | null;
  origin: string;
};

export type PortalInput = { customerId: string; origin: string };

export type BillingProvider = {
  kind: BillingProviderKind;
  startCheckout(input: CheckoutInput): Promise<string>;
  openPortal(input: PortalInput): Promise<string>;
  /** The provider's view of a subscription for the billing check; null when the provider has no such subscription. */
  getSubscription(id: string): Promise<ProviderSubscription | null>;
};

type Env = Record<string, string | undefined>;

export const BILLING_NOT_SET_UP = "Billing is not set up yet.";

const STRIPE_VARIABLES = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_STARTER_MONTHLY",
  "STRIPE_PRICE_STARTER_ANNUAL",
] as const;

export function stripeConfigured(env: Env = process.env): boolean {
  return STRIPE_VARIABLES.every((name) => Boolean(env[name]));
}

/** True when at least one Stripe variable is set: a partial config is a broken Stripe setup, not "no Stripe". */
function anyStripeVariable(env: Env): boolean {
  return STRIPE_VARIABLES.some((name) => Boolean(env[name]));
}

/** Stripe refuses a trial_end less than 48 hours away. */
const MIN_TRIAL_END_MS = 48 * 60 * 60 * 1000;

/** Unix seconds for subscription_data.trial_end, or null when the trial is too close to its end (charge now). */
export function checkoutTrialEnd(trialEndsAt: string | null, now: Date = new Date()): number | null {
  if (!trialEndsAt) return null;
  const end = Date.parse(trialEndsAt);
  if (!Number.isFinite(end) || end - now.getTime() <= MIN_TRIAL_END_MS) return null;
  return Math.floor(end / 1000);
}

const billingUrl = (origin: string, path: string) => new URL(path, origin).toString();

export function checkoutSessionParams(env: Env, input: CheckoutInput, now: Date = new Date()): Stripe.Checkout.SessionCreateParams {
  const price = input.interval === "year" ? env.STRIPE_PRICE_STARTER_ANNUAL : env.STRIPE_PRICE_STARTER_MONTHLY;
  if (!price) throw new Error(BILLING_NOT_SET_UP);
  const trialEnd = checkoutTrialEnd(input.trialEndsAt, now);
  return {
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    client_reference_id: input.businessId,
    metadata: { business_id: input.businessId, interval: input.interval },
    ...(input.customerId
      ? { customer: input.customerId, customer_update: { address: "auto" as const, name: "auto" as const } }
      : {}),
    automatic_tax: { enabled: true },
    subscription_data: {
      metadata: { business_id: input.businessId },
      ...(trialEnd !== null ? { trial_end: trialEnd } : {}),
    },
    success_url: billingUrl(input.origin, "/settings?tab=billing&checkout=success"),
    cancel_url: billingUrl(input.origin, "/settings?tab=billing&checkout=cancel"),
  };
}

function stripeProvider(env: Env): BillingProvider {
  const client = () => new Stripe(env.STRIPE_SECRET_KEY as string);
  return {
    kind: "stripe",
    async startCheckout(input) {
      const session = await client().checkout.sessions.create(checkoutSessionParams(env, input));
      if (!session.url) throw new Error("Stripe did not return a checkout URL.");
      return session.url;
    },
    async openPortal(input) {
      const session = await client().billingPortal.sessions.create({
        customer: input.customerId,
        return_url: billingUrl(input.origin, "/settings?tab=billing"),
      });
      return session.url;
    },
    async getSubscription(id) {
      try {
        return subscriptionSnapshot(await client().subscriptions.retrieve(id));
      } catch (error) {
        if (isMissingResource(error)) return null;
        throw error;
      }
    },
  };
}

/** Stripe answers an unknown subscription id with a 404 resource_missing error. */
function isMissingResource(error: unknown): boolean {
  const e = error as { code?: unknown; statusCode?: unknown } | null;
  return e?.code === "resource_missing" || e?.statusCode === 404;
}

/** Subscription ids the pretend provider makes (lib/billing/pretend-events.ts): pretend_sub_<business id>. */
const PRETEND_SUBSCRIPTION_PREFIX = "pretend_sub_";

/**
 * The pretend provider's view of a subscription is our own row, so a local check agrees end to end. An id it did not
 * make (for example a Stripe-like sub_… set by hand in a test) does not exist there, which the check flags.
 */
async function pretendSubscription(id: string): Promise<ProviderSubscription | null> {
  if (!id.startsWith(PRETEND_SUBSCRIPTION_PREFIX)) return null;
  const { createAdminClient } = await import("../supabase/admin.ts");
  const { data, error } = await createAdminClient()
    .from("subscriptions")
    .select("status, current_period_end, cancel_at, trial_ends_at")
    .eq("stripe_subscription_id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    exists: true,
    status: data.status as string,
    currentPeriodEnd: data.current_period_end as string | null,
    cancelAt: data.cancel_at as string | null,
    trialEnd: data.trial_ends_at as string | null,
  };
}

const pretendProvider: BillingProvider = {
  kind: "pretend",
  async startCheckout(input) {
    return billingUrl(input.origin, `/billing/pretend?interval=${encodeURIComponent(input.interval)}`);
  },
  async openPortal(input) {
    return billingUrl(input.origin, "/billing/pretend/portal");
  },
  getSubscription: pretendSubscription,
};

const noProvider: BillingProvider = {
  kind: "none",
  async startCheckout() {
    throw new Error(BILLING_NOT_SET_UP);
  },
  async openPortal() {
    throw new Error(BILLING_NOT_SET_UP);
  },
  async getSubscription() {
    throw new Error(BILLING_NOT_SET_UP);
  },
};

/**
 * Stripe when fully configured; the pretend provider only outside production and with no Stripe variable set;
 * otherwise none (a partial Stripe config is "billing not set up" in every NODE_ENV).
 */
export function billingProvider(env: Env = process.env): BillingProvider {
  if (stripeConfigured(env)) return stripeProvider(env);
  if (env.NODE_ENV !== "production" && !anyStripeVariable(env)) return pretendProvider;
  return noProvider;
}
