// SERVER ONLY. The Razorpay webhook, with its collaborators injected so it can be tested without Razorpay or a database.
import { normalizeRazorpayEvent, verifyRazorpaySignature, type RazorpayWebhook } from "./razorpay-events.ts";
import { BillingEventError, webhookStatus, type ApplyResult } from "./apply-event.ts";
import type { BillingEvent } from "./events.ts";
import type { BillingProvider } from "./provider.ts";

export type WebhookDeps = {
  secret: string | undefined;
  applyEvent(event: BillingEvent): Promise<ApplyResult>;
  provider(): Pick<BillingProvider, "cancel">;
};

export async function handleRazorpayWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  if (!deps.secret) return Response.json({ error: "Billing is not set up yet." }, { status: 503 });

  // The signature covers the exact bytes Razorpay sent, so read the raw body before any parsing.
  const payload = await request.text();
  if (!verifyRazorpaySignature(payload, request.headers.get("x-razorpay-signature"), deps.secret)) {
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
    const result = await deps.applyEvent(event);
    // A second paid subscription for a shop that already has one: stop it charging. superseded is not recorded, so a
    // redelivery lands here again, and cancel treats "already cancelled" as success. A failure is a 500 for a retry.
    if (result === "superseded" && event.businessId && event.subscriptionId) {
      await deps.provider().cancel({ businessId: event.businessId, subscriptionId: event.subscriptionId, atPeriodEnd: false });
    }
    return Response.json({ result }, { status: webhookStatus(result) });
  } catch (error) {
    if (error instanceof BillingEventError && error.permanent) {
      return Response.json({ error: "The event could not be applied." }, { status: 400 });
    }
    // Database or network trouble: a 5xx makes Razorpay retry.
    return Response.json({ error: "The event could not be applied right now." }, { status: 500 });
  }
}
