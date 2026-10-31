export type BillingEventKind =
  | "checkout_completed"
  | "subscription_changed"
  | "subscription_deleted"
  | "invoice_paid"
  | "payment_failed"
  | "trial_card_removed";

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
