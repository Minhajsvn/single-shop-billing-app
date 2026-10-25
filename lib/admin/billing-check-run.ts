// SERVER ONLY. Runs the billing check: for each shop with a Stripe subscription id, compare our subscriptions row with
// the provider's view and record the result through admin_record_billing_check. It reads subscriptions and never
// writes them (tests/billing-check.test.mjs holds it to that). Callers check staff or the cron secret first.
import { compareSubscription, MISSING_SUBSCRIPTION, type SubscriptionRow } from "../billing/billing-check.ts";
import { billingProvider, BILLING_NOT_SET_UP, type BillingProvider } from "../billing/provider.ts";
import { createAdminClient } from "../supabase/admin.ts";

export type BillingCheckResult = { checked: number; mismatches: number; failed: number } | { error: string };

type RpcResult = PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;

/** The slice of the service-role client the runner uses (a fake in tests). */
export type BillingCheckAdmin = {
  rpc(name: string, args?: Record<string, unknown>): RpcResult;
  from(table: "subscriptions"): {
    select(columns: string): { eq(column: string, value: string): { maybeSingle(): RpcResult } };
  };
};

type Row = SubscriptionRow & { stripe_subscription_id: string | null };

export async function runBillingCheckWith(
  deps: { admin: BillingCheckAdmin; provider: Pick<BillingProvider, "kind" | "getSubscription"> },
  input: { businessId?: string },
): Promise<BillingCheckResult> {
  const { admin, provider } = deps;
  if (provider.kind === "none") return { error: BILLING_NOT_SET_UP };

  const { data: ids, error } = await admin.rpc("admin_billing_check_shops");
  if (error) throw error;
  const shops = ((ids ?? []) as string[]).filter((id) => !input.businessId || id === input.businessId);

  let checked = 0;
  let mismatches = 0;
  let failed = 0;
  for (const businessId of shops) {
    try {
      const { data, error: readError } = await admin.from("subscriptions")
        .select("status, stripe_subscription_id, current_period_end, cancel_at, trial_ends_at")
        .eq("business_id", businessId)
        .maybeSingle();
      if (readError) throw readError;
      const row = data as Row | null;
      if (!row?.stripe_subscription_id) continue;

      const theirs = (await provider.getSubscription(row.stripe_subscription_id)) ?? MISSING_SUBSCRIPTION;
      const found = compareSubscription(row, theirs);
      const { error: recordError } = await admin.rpc("admin_record_billing_check", { p_business_id: businessId, p_mismatches: found });
      if (recordError) throw recordError;
      checked += 1;
      mismatches += found.length;
    } catch (failure) {
      failed += 1;
      const detail = failure as { code?: string; message?: string };
      console.error("billing check failed for a shop", businessId, detail?.code, detail?.message);
    }
  }
  return { checked, mismatches, failed };
}

/** Every shop with a Stripe subscription, or just `businessId`. Provider none: nothing is done. */
export async function runBillingCheck(input: { businessId?: string }): Promise<BillingCheckResult> {
  const provider = billingProvider();
  if (provider.kind === "none") return { error: BILLING_NOT_SET_UP };
  return runBillingCheckWith({ admin: createAdminClient() as unknown as BillingCheckAdmin, provider }, input);
}
