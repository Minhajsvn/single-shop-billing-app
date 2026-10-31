import { billingProvider, BILLING_NOT_SET_UP } from "@/lib/billing/provider";
import { loadOwnerBilling } from "@/lib/billing/owner-session";
import { cancelDecision } from "@/lib/billing/cancel-decision";
import { runCancel } from "@/lib/billing/run-cancel";
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

    const admin = createAdminClient();
    const outcome = await runCancel(
      decision,
      // cancelDecision only lets a row with a subscription id through.
      { businessId: owner.businessId, subscriptionId: owner.subscriptionId as string, userId: owner.userId },
      {
        provider,
        recordCancel: ({ businessId, cancelAt, actorId }) =>
          Promise.resolve(admin.rpc("record_billing_cancel", { p_business: businessId, p_cancel_at: cancelAt, p_actor: actorId })),
        clearCancelAt: (businessId) =>
          Promise.resolve(admin.from("subscriptions").update({ cancel_at: null }).eq("business_id", businessId)),
      },
    );
    if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
    return Response.json({ cancelAt: outcome.cancelAt });
  } catch {
    return Response.json({ error: "The subscription could not be cancelled. Try again." }, { status: 502 });
  }
}
