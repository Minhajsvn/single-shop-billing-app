import { z } from "zod";
import { readJson, staffSession } from "@/lib/staff/route";
import { NO_STORE, UUID, profitRefusal, profitRpcFailure } from "@/lib/profit/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

const bodySchema = z.object({ costFils: z.number().int().min(0).max(100_000_000).nullable() });

/** Stage 2C: set or clear one product's cost (excl. VAT). Owner only, Pro only; audited by set_product_cost. */
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  if (!UUID.test(id)) return profitRefusal("product_not_found");
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return profitRefusal("invalid_cost");
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId } = auth.session;
  const { error } = await supabase.rpc("set_product_cost", { p_business_id: businessId, p_product_id: id, p_cost_fils: parsed.data.costFils });
  if (error) return profitRpcFailure("set_product_cost", error);
  return new Response(null, { status: 204, headers: NO_STORE });
}
