// SERVER ONLY: shared by the billing route handlers.
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ownerGuard, type BillingMembership } from "@/lib/billing/owner-guard";

export type OwnerBilling = {
  businessId: string;
  customerId: string | null;
  subscriptionId: string | null;
  status: string | null;
  trialEndsAt: string | null;
};

/** The signed-in owner's subscription row, or the Response to send back instead. */
export async function loadOwnerBilling(): Promise<OwnerBilling | Response> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: membership, error: memberError } = user
    ? await supabase.from("business_members").select("business_id, role, status")
      .eq("user_id", user.id).eq("status", "active").limit(1).maybeSingle()
    : { data: null, error: null };
  if (memberError) return Response.json({ error: memberError.message }, { status: 502 });
  const denied = ownerGuard(user, membership as BillingMembership | null);
  if (denied) return Response.json({ error: denied.error }, { status: denied.status });

  const businessId = (membership as BillingMembership).business_id;
  const { data: sub, error } = await supabase.from("subscriptions")
    .select("stripe_customer_id, stripe_subscription_id, status, trial_ends_at")
    .eq("business_id", businessId).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 502 });
  return {
    businessId,
    customerId: sub?.stripe_customer_id ?? null,
    subscriptionId: sub?.stripe_subscription_id ?? null,
    status: sub?.status ?? null,
    trialEndsAt: sub?.trial_ends_at ?? null,
  };
}
