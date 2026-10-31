// What the cancel route does for a given subscription row. Pure, so "cancel pressed twice" is tested without I/O.
import { dubaiDate } from "./lifecycle-view.ts";

export type CancelOwner = {
  subscriptionId: string | null;
  status: string | null;
  cancelAt: string | null;
  currentPeriodEnd: string | null;
  hasPaymentMethod: boolean;
};

export type CancelDecision =
  | { action: "refuse"; status: 409; error: string }
  | { action: "remove_trial_card" }
  | { action: "cancel_at_period_end"; cancelAt: string | null };

export function cancelDecision(owner: CancelOwner): CancelDecision {
  if (!owner.subscriptionId || owner.status === null || owner.status === "canceled") {
    return { action: "refuse", status: 409, error: "There is no active subscription to cancel." };
  }
  if (owner.cancelAt) {
    return { action: "refuse", status: 409, error: `This subscription already ends on ${dubaiDate(owner.cancelAt, true)}.` };
  }
  // A card-saved trial has not been charged: cancelling it removes the card at once and the shop keeps its trial days.
  if (owner.status === "trialing" && owner.hasPaymentMethod) return { action: "remove_trial_card" };
  return { action: "cancel_at_period_end", cancelAt: owner.currentPeriodEnd };
}
