import { staffSession } from "@/lib/staff/route";
import { DATE, NO_STORE, promotionRefusal, promotionRpcFailure } from "@/lib/promotions/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Stage 2E: what each promotion did between two Dubai dates (at most 92 days). */
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const from = search.get("from") ?? "";
  const to = search.get("to") ?? "";
  if (!DATE.test(from) || !DATE.test(to)) return promotionRefusal("invalid_range");
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId } = auth.session;
  const { data, error } = await supabase.rpc("promotion_results", { p_business_id: businessId, p_from: from, p_to: to });
  if (error) return promotionRpcFailure("promotion_results", error);
  return Response.json({ results: data ?? [] }, { headers: NO_STORE });
}
