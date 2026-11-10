import { staffSession } from "@/lib/staff/route";
import { NO_STORE, profitRpcFailure } from "@/lib/profit/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Stage 2C: every costed product of the shop, for an owner or manager on Pro. Never cached. */
export async function GET() {
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId } = auth.session;
  const { data, error } = await supabase.rpc("product_costs", { p_business_id: businessId });
  if (error) return profitRpcFailure("product_costs", error);
  const costs = ((data ?? []) as { product_id: string; cost_fils: number }[]).map((row) => ({ productId: row.product_id, costFils: Number(row.cost_fils) }));
  return Response.json({ costs }, { headers: NO_STORE });
}
