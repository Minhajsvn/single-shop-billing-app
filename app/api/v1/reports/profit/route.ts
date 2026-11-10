import { staffSession } from "@/lib/staff/route";
import { DATE, NO_STORE, profitRefusal, profitRpcFailure } from "@/lib/profit/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Stage 2C: profit between two Dubai business dates, for an owner or manager on Pro. Never cached. */
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const from = search.get("from") ?? "";
  const to = search.get("to") ?? "";
  if (!DATE.test(from) || !DATE.test(to)) return profitRefusal("invalid_range");
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId } = auth.session;
  const { data, error } = await supabase.rpc("profit_report", { p_business_id: businessId, p_from: from, p_to: to });
  if (error) return profitRpcFailure("profit_report", error);
  return Response.json(data, { headers: NO_STORE });
}
