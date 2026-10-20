import { normalizeStripeEvent, verifyStripeEvent } from "@/lib/billing/stripe-events";
import { applyBillingEvent, BillingEventError, webhookStatus } from "@/lib/billing/apply-event";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Billing is not set up yet." }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing Stripe signature." }, { status: 400 });

  // The signature covers the exact bytes Stripe sent, so read the raw body before any parsing.
  const payload = await request.text();
  let stripeEvent;
  try {
    stripeEvent = verifyStripeEvent(payload, signature, secret);
  } catch {
    return Response.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

  const event = normalizeStripeEvent(stripeEvent);
  if (!event) return Response.json({ result: "ignored" });

  try {
    const result = await applyBillingEvent(event);
    return Response.json({ result }, { status: webhookStatus(result) });
  } catch (error) {
    if (error instanceof BillingEventError && error.permanent) {
      return Response.json({ error: "The event could not be applied." }, { status: 400 });
    }
    // Database or network trouble: a 5xx makes Stripe retry.
    return Response.json({ error: "The event could not be applied right now." }, { status: 500 });
  }
}
