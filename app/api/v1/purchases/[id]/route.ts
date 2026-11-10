import { staffSession } from "@/lib/staff/route";
import { NO_STORE, UUID, purchasingRefusal, purchasingRpcFailure } from "@/lib/purchasing/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

/** Stage 2D: one delivery with its lines. */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!UUID.test(id)) return purchasingRefusal("receipt_not_found");
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId } = auth.session;
  const { data, error } = await supabase.rpc("purchase_receipt_get", { p_business_id: businessId, p_id: id });
  if (error) return purchasingRpcFailure("purchase_receipt_get", error);
  return Response.json(data, { headers: NO_STORE });
}
