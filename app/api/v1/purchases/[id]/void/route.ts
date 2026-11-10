import { z } from "zod";
import { readJson, staffSession } from "@/lib/staff/route";
import { NO_STORE, UUID, purchasingRefusal, purchasingRpcFailure } from "@/lib/purchasing/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

const bodySchema = z.object({ reason: z.string().trim().min(1).max(200) });

/** Stage 2D: void a delivery (stock back out, cost unchanged). */
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  if (!UUID.test(id)) return purchasingRefusal("receipt_not_found");
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return purchasingRefusal("invalid_reason");
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId } = auth.session;
  const { error } = await supabase.rpc("void_purchase_receipt", { p_business_id: businessId, p_receipt_id: id, p_reason: parsed.data.reason });
  if (error) return purchasingRpcFailure("void_purchase_receipt", error);
  return new Response(null, { status: 204, headers: NO_STORE });
}
