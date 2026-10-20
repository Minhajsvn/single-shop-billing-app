// Development-only pretend billing: builds the same BillingEvents a Stripe webhook would deliver,
// so every state goes through the real apply_billing_event lifecycle. Pure; the route does the I/O.
import type { BillingEvent, BillingInterval } from "./stripe-events.ts";

export type PretendAction =
  | "pay"
  | "decline"
  | "update_card"
  | "cancel"
  | "fail_renewal"
  | "end_trial"
  | "end_grace"
  | "renew";

export const PRETEND_ACTIONS: readonly PretendAction[] = [
  "pay", "decline", "update_card", "cancel", "fail_renewal", "end_trial", "end_grace", "renew",
];

export type PretendContext = {
  businessId: string;
  interval: BillingInterval;
  now: Date;
  trialEndsAt: string | null;
  /** True once a card is on file (a completed checkout). Needed by end_trial. */
  hasPaymentMethod?: boolean;
  /** Set while the subscription is cancelling at period end; a later renew then deletes it. */
  cancelAt?: string | null;
  currentPeriodEnd?: string | null;
};

export function isPretendAction(value: unknown): value is PretendAction {
  return typeof value === "string" && (PRETEND_ACTIONS as readonly string[]).includes(value);
}

/** The pretend route exists only for the pretend provider. */
export const pretendAvailable = (providerKind: string) => providerKind === "pretend";

const addPeriod = (from: Date, interval: BillingInterval) => {
  const end = new Date(from);
  if (interval === "year") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
};

export function pretendEvent(action: PretendAction, ctx: PretendContext): BillingEvent[] {
  const customerId = `pretend_cus_${ctx.businessId}`;
  const subscriptionId = `pretend_sub_${ctx.businessId}`;
  // Strictly increasing within one action so none is judged stale.
  let tick = 0;
  const make = (kind: BillingEvent["kind"], extra: Partial<BillingEvent> = {}): BillingEvent => ({
    id: `pretend_${crypto.randomUUID()}`,
    created: new Date(ctx.now.getTime() + tick++).toISOString(),
    kind,
    businessId: ctx.businessId,
    customerId,
    subscriptionId,
    status: null,
    trialEnd: null,
    currentPeriodEnd: null,
    cancelAt: null,
    interval: ctx.interval,
    ...extra,
  });

  const trialRunning = ctx.trialEndsAt !== null && Date.parse(ctx.trialEndsAt) > ctx.now.getTime();
  const newPeriodEnd = addPeriod(ctx.now, ctx.interval).toISOString();
  const periodEnd = ctx.currentPeriodEnd ?? newPeriodEnd;

  switch (action) {
    case "pay":
      return [make("checkout_completed", trialRunning
        ? { status: "trialing", trialEnd: ctx.trialEndsAt, currentPeriodEnd: ctx.trialEndsAt }
        : { status: "active", currentPeriodEnd: newPeriodEnd })];
    case "decline":
    case "end_grace":
      return [];
    case "update_card":
      return [make("invoice_paid", { currentPeriodEnd: periodEnd })];
    case "cancel":
      return [make("subscription_changed", { cancelAt: periodEnd, currentPeriodEnd: periodEnd })];
    case "fail_renewal":
      return [make("payment_failed")];
    case "end_trial":
      return ctx.hasPaymentMethod ? [make("invoice_paid", { currentPeriodEnd: newPeriodEnd })] : [];
    case "renew":
      return ctx.cancelAt
        ? [make("subscription_deleted", { status: "canceled" })]
        : [make("invoice_paid", { currentPeriodEnd: newPeriodEnd })];
  }
}
