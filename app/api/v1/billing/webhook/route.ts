import { normalizeRazorpayEvent, verifyRazorpaySignature, type RazorpayWebhook } from "@/lib/billing/razorpay-events";
import { applyBillingEvent, BillingEventError, webhookStatus } from "@/lib/billing/apply-event";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Billing is not set up yet." }, { status: 503 });

  // The signature covers the exact bytes Razorpay sent, so read the raw body before any parsing.
  const payload = await request.text();
  if (!verifyRazorpaySignature(payload, request.headers.get("x-razorpay-signature"), secret)) {
    return Response.json({ error: "Invalid Razorpay signature." }, { status: 400 });
  }
  // The event id (for duplicate detection) is a header, not part of the signed body.
  const eventId = request.headers.get("x-razorpay-event-id");
  if (!eventId) return Response.json({ error: "Missing Razorpay event id." }, { status: 400 });

  let body: RazorpayWebhook;
  try {
    body = JSON.parse(payload) as RazorpayWebhook;
  } catch {
    return Response.json({ error: "The event could not be read." }, { status: 400 });
  }

  const event = normalizeRazorpayEvent(eventId, body);
  if (!event) return Response.json({ result: "ignored" });

  try {
    const result = await applyBillingEvent(event);
    return Response.json({ result }, { status: webhookStatus(result) });
  } catch (error) {
    if (error instanceof BillingEventError && error.permanent) {
      return Response.json({ error: "The event could not be applied." }, { status: 400 });
    }
    // Database or network trouble: a 5xx makes Razorpay retry.
    return Response.json({ error: "The event could not be applied right now." }, { status: 500 });
  }
}
