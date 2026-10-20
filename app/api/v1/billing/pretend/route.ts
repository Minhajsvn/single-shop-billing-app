import { billingProvider } from "@/lib/billing/provider";
import { loadOwnerBilling } from "@/lib/billing/owner-session";
import { applyBillingEvent } from "@/lib/billing/apply-event";
import { isPretendAction, pretendAvailable, pretendEvent } from "@/lib/billing/pretend-events";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Development only: drives billing states through the same lifecycle code a Stripe webhook uses. */
export async function POST(request: Request) {
  if (!pretendAvailable(billingProvider().kind)) return Response.json({ error: "Not found." }, { status: 404 });
  try {
    const owner = await loadOwnerBilling();
    if (owner instanceof Response) return owner;

    const body = (await request.json().catch(() => null)) as { action?: unknown; interval?: unknown } | null;
    if (!isPretendAction(body?.action)) return Response.json({ error: "Unknown action." }, { status: 400 });
    const interval = body?.interval === "year" ? "year" : "month";
    const action = body.action;

    const admin = createAdminClient();
    const { data: sub, error } = await admin.from("subscriptions")
      .select("trial_ends_at, has_payment_method, cancel_at, current_period_end, billing_interval")
      .eq("business_id", owner.businessId).maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 502 });

    const now = new Date();
    if (action === "end_trial" || action === "end_grace") {
      const column = action === "end_trial" ? "trial_ends_at" : "grace_ends_at";
      const { error: moveError } = await admin.from("subscriptions")
        .update({ [column]: now.toISOString() }).eq("business_id", owner.businessId);
      if (moveError) return Response.json({ error: moveError.message }, { status: 502 });
    }

    const events = pretendEvent(action, {
      businessId: owner.businessId,
      interval: action === "pay" ? interval : (sub?.billing_interval ?? interval),
      now,
      trialEndsAt: sub?.trial_ends_at ?? null,
      hasPaymentMethod: sub?.has_payment_method === true,
      cancelAt: sub?.cancel_at ?? null,
      currentPeriodEnd: sub?.current_period_end ?? null,
    });
    const results: string[] = [];
    for (const event of events) results.push(await applyBillingEvent(event));
    return Response.json({ ok: true, results });
  } catch {
    return Response.json({ error: "The pretend action failed. Try again." }, { status: 502 });
  }
}
