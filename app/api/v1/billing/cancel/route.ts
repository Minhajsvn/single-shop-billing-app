import { billingProvider, BILLING_NOT_SET_UP } from "@/lib/billing/provider";
import { loadOwnerBilling } from "@/lib/billing/owner-session";
import { cancelDecision } from "@/lib/billing/cancel-decision";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const provider = billingProvider();
  try {
    const owner = await loadOwnerBilling();
    if (owner instanceof Response) return owner;
    if (provider.kind === "none") return Response.json({ error: BILLING_NOT_SET_UP }, { status: 503 });

    const decision = cancelDecision(owner);
    if (decision.action === "refuse") return Response.json({ error: decision.error }, { status: decision.status });

    // cancelDecision only lets a row with a subscription id through.
    const subscriptionId = owner.subscriptionId as string;
    // A card-saved trial is cancelled now (nothing was charged); anything else ends at the period end.
    const removeCard = decision.action === "remove_trial_card";
    const cancelAt = decision.action === "cancel_at_period_end" ? decision.cancelAt : null;
    await provider.cancel({ businessId: owner.businessId, subscriptionId, atPeriodEnd: !removeCard });

    // The audit row is written either way; the provider call above has already succeeded.
    const { error } = await createAdminClient().rpc("record_billing_cancel", {
      p_business: owner.businessId, p_cancel_at: cancelAt, p_actor: owner.userId,
    });
    if (error) throw error;
    return Response.json({ cancelAt });
  } catch {
    return Response.json({ error: "The subscription could not be cancelled. Try again." }, { status: 502 });
  }
}
