// SERVER ONLY. The order of a cancel: record first, then the provider, so a failed record never leaves Razorpay
// ending a subscription our shop row still shows as running.
import type { CancelDecision } from "./cancel-decision.ts";
import type { BillingProvider } from "./provider.ts";

export type CancelDeps = {
  provider: Pick<BillingProvider, "cancel">;
  /** public.record_billing_cancel through the service-role client. */
  recordCancel(args: { businessId: string; cancelAt: string | null; actorId: string }): Promise<{ error: unknown }>;
  /** Puts subscriptions.cancel_at back to null for the business (compensation). */
  clearCancelAt(businessId: string): Promise<{ error: unknown }>;
};

export type CancelOutcome = { ok: true; cancelAt: string | null } | { ok: false; status: 502; error: string };

const FAILED: CancelOutcome = { ok: false, status: 502, error: "The subscription could not be cancelled. Try again." };

export async function runCancel(
  decision: Exclude<CancelDecision, { action: "refuse" }>,
  input: { businessId: string; subscriptionId: string; userId: string },
  deps: CancelDeps,
): Promise<CancelOutcome> {
  const removeCard = decision.action === "remove_trial_card";
  // A card-saved trial records no cancel date: the shop just keeps its trial.
  const cancelAt = decision.action === "cancel_at_period_end" ? decision.cancelAt : null;

  const recorded = await deps.recordCancel({ businessId: input.businessId, cancelAt, actorId: input.userId });
  if (recorded.error) return FAILED;

  try {
    await deps.provider.cancel({ businessId: input.businessId, subscriptionId: input.subscriptionId, atPeriodEnd: !removeCard });
  } catch {
    // The audit row stays as the record of the attempt; the visible cancel date must not claim a cancel that failed.
    if (!removeCard) await deps.clearCancelAt(input.businessId).catch(() => undefined);
    return FAILED;
  }
  return { ok: true, cancelAt };
}
