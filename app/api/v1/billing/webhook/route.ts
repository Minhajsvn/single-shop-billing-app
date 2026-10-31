import { handleRazorpayWebhook } from "@/lib/billing/webhook-handler";
import { applyBillingEvent } from "@/lib/billing/apply-event";
import { billingProvider } from "@/lib/billing/provider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleRazorpayWebhook(request, {
    secret: process.env.RAZORPAY_WEBHOOK_SECRET,
    applyEvent: applyBillingEvent,
    provider: () => billingProvider(),
  });
}
