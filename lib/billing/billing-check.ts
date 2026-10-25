// Pure comparison for the daily billing check: our subscriptions row against the billing provider's subscription.
// No I/O and no Stripe import, so it is safe anywhere. The check only reports; it never changes a subscription.

/** The provider's view of one subscription. `exists: false` means the provider has no such subscription. */
export type ProviderSubscription = {
  exists: boolean;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAt: string | null;
  trialEnd: string | null;
};

/** The columns of public.subscriptions the check compares. */
export type SubscriptionRow = {
  status: string;
  current_period_end: string | null;
  cancel_at: string | null;
  trial_ends_at: string | null;
};

export type FlagField = "status" | "current_period_end" | "cancel_at" | "trial_end" | "exists";

export type Mismatch = { field: FlagField; ours: string | null; theirs: string | null };

export const FLAG_FIELDS: readonly FlagField[] = ["status", "current_period_end", "cancel_at", "trial_end", "exists"];

/** Times within this much of each other agree (webhooks and clocks drift a little). */
export const TIME_TOLERANCE_MS = 60 * 60 * 1000;

export const MISSING_SUBSCRIPTION: ProviderSubscription = {
  exists: false, status: null, currentPeriodEnd: null, cancelAt: null, trialEnd: null,
};

/**
 * The status we would hold for a Stripe status, mapped the way public.apply_billing_event maps webhook statuses:
 * unpaid counts as past_due; incomplete, incomplete_expired, paused and anything unknown are never applied (null),
 * so they are not a disagreement. canceled is what subscription_deleted sets.
 */
export function ourStatusFor(stripeStatus: string | null): string | null {
  switch (stripeStatus) {
    case "trialing":
    case "active":
    case "canceled":
      return stripeStatus;
    case "past_due":
    case "unpaid":
      return "past_due";
    default:
      return null;
  }
}

const iso = (value: string | null): string | null => {
  if (value === null) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
};

function sameTime(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const diff = Math.abs(Date.parse(a) - Date.parse(b));
  return Number.isFinite(diff) && diff <= TIME_TOLERANCE_MS;
}

/** Every field on which our row and the provider disagree, in FLAG_FIELDS order. */
export function compareSubscription(ours: SubscriptionRow, theirs: ProviderSubscription): Mismatch[] {
  if (!theirs.exists) return [{ field: "exists", ours: "yes", theirs: "no" }];

  const mismatches: Mismatch[] = [];
  const mapped = ourStatusFor(theirs.status);
  if (mapped !== null && mapped !== ours.status) mismatches.push({ field: "status", ours: ours.status, theirs: theirs.status });

  // Ended on both sides: Stripe keeps the old period and cancel dates on a canceled subscription, we clear cancel_at.
  if (ours.status === "canceled" && mapped === "canceled") return mismatches;

  const times: [FlagField, string | null, string | null][] = [
    ["current_period_end", ours.current_period_end, theirs.currentPeriodEnd],
    ["cancel_at", ours.cancel_at, theirs.cancelAt],
  ];
  // Our trial_ends_at is also the signup trial, which Stripe never sees when the owner paid without a trial:
  // a missing Stripe trial end only disagrees while we still think the shop is trialing.
  if (theirs.trialEnd !== null || ours.status === "trialing") times.push(["trial_end", ours.trial_ends_at, theirs.trialEnd]);

  for (const [field, a, b] of times) {
    if (!sameTime(a, b)) mismatches.push({ field, ours: iso(a), theirs: iso(b) });
  }
  return mismatches;
}

const FIELD_LABELS: Record<FlagField, string> = {
  status: "Status",
  current_period_end: "Current period end",
  cancel_at: "Cancel date",
  trial_end: "Trial end",
  exists: "Subscription exists in Stripe",
};

export function flagFieldLabel(field: string): string {
  return Object.hasOwn(FIELD_LABELS, field) ? FIELD_LABELS[field as FlagField] : field;
}

const TIME_FIELDS = new Set(["current_period_end", "cancel_at", "trial_end"]);
const STATUS_WORDS: Record<string, string> = {
  trialing: "Trialing", active: "Active", past_due: "Past due", unpaid: "Unpaid", canceled: "Canceled",
};

/** A flag value in plain words: dates through `formatTime`, statuses capitalised, yes/no, a dash for none. */
export function flagValueText(field: string, value: string | null, formatTime: (iso: string) => string): string {
  if (value === null || value === "") return field === "cancel_at" ? "Not cancelling" : "—";
  if (TIME_FIELDS.has(field)) return formatTime(value);
  if (field === "exists") return value === "yes" ? "Yes" : "No";
  if (field === "status") return STATUS_WORDS[value] ?? value;
  return value;
}
