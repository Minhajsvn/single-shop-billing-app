import { billingProvider } from "@/lib/billing/provider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Which billing provider this server runs. Reveals only "stripe", "pretend" or "none", so no sign-in is needed. */
export async function GET() {
  return Response.json({ kind: billingProvider().kind });
}
