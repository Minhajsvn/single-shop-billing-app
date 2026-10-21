import { billingProvider, BILLING_NOT_SET_UP } from "@/lib/billing/provider";
import { loadOwnerBilling } from "@/lib/billing/owner-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const provider = billingProvider();
  try {
    const owner = await loadOwnerBilling();
    if (owner instanceof Response) return owner;
    if (provider.kind === "none") return Response.json({ error: BILLING_NOT_SET_UP }, { status: 503 });

    const body: unknown = await request.json().catch(() => null);
    const interval = (body as { interval?: unknown } | null)?.interval;
    if (interval !== "month" && interval !== "year") {
      return Response.json({ error: "Choose monthly or yearly billing." }, { status: 400 });
    }
    // A second checkout would start a second, separately charged subscription.
    if (owner.subscriptionId && owner.status !== "canceled") {
      return Response.json({ error: "This shop already has a subscription. Use Manage billing to change it." }, { status: 409 });
    }

    const url = await provider.startCheckout({
      businessId: owner.businessId,
      customerId: owner.customerId,
      interval,
      trialEndsAt: owner.status === "trialing" ? owner.trialEndsAt : null,
      origin: new URL(request.url).origin,
    });
    return Response.json({ url });
  } catch {
    return Response.json({ error: "Checkout could not be started. Try again." }, { status: 502 });
  }
}
