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
    if (!owner.customerId) {
      return Response.json({ error: "There is no billing account yet. Choose a plan first." }, { status: 409 });
    }
    const url = await provider.openPortal({ customerId: owner.customerId, origin: new URL(request.url).origin });
    return Response.json({ url });
  } catch {
    return Response.json({ error: "Billing could not be opened. Try again." }, { status: 502 });
  }
}
