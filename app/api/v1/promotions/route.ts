import { z } from "zod";
import { readJson, staffSession } from "@/lib/staff/route";
import { DATE, NO_STORE, promotionRefusal, promotionRpcFailure } from "@/lib/promotions/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Stage 2E: every promotion of the shop (owner or manager on Pro). */
export async function GET() {
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId } = auth.session;
  const { data, error } = await supabase.rpc("promotion_list", { p_business_id: businessId });
  if (error) return promotionRpcFailure("promotion_list", error);
  return Response.json({ promotions: data ?? [] }, { headers: NO_STORE });
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const promotionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(40),
  kind: z.enum(["percent_off", "amount_off", "multi_buy_free", "multi_buy_price", "basket_percent"]),
  targetType: z.enum(["product", "category", "all"]),
  targetId: z.string().uuid().nullable(),
  percent: z.number().min(0.1).max(99).nullable(),
  amountFils: z.number().int().min(1).max(100_000).nullable(),
  buyQty: z.number().int().min(1).max(99).nullable(),
  getQty: z.number().int().min(1).max(99).nullable(),
  bundlePriceFils: z.number().int().min(1).nullable(),
  minBasketFils: z.number().int().min(0).max(10_000_000).nullable(),
  startsOn: z.string().regex(DATE),
  endsOn: z.string().regex(DATE).nullable(),
  days: z.array(z.number().int().min(1).max(7)).min(1).max(7).nullable(),
  fromTime: z.string().regex(TIME).nullable(),
  toTime: z.string().regex(TIME).nullable(),
  active: z.boolean(),
  archived: z.boolean(),
}).passthrough();

/** Stage 2E: add or change a promotion (pause, resume and archive too). The server checks every rule again. */
export async function PUT(request: Request) {
  const parsed = promotionSchema.safeParse(await readJson(request));
  if (!parsed.success) return promotionRefusal("invalid_promotion");
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId } = auth.session;
  const { error } = await supabase.rpc("promotion_save", { p_business_id: businessId, p_promotion: parsed.data });
  if (error) return promotionRpcFailure("promotion_save", error);
  return new Response(null, { status: 204, headers: NO_STORE });
}
