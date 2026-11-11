import { z } from "zod";
import { readJson, staffSession } from "@/lib/staff/route";
import { NO_STORE, purchasingRefusal, purchasingRpcFailure } from "@/lib/purchasing/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Stage 2D: the shop's suppliers (owner or manager on Pro). */
export async function GET() {
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId } = auth.session;
  const { data, error } = await supabase.rpc("supplier_list", { p_business_id: businessId });
  if (error) return purchasingRpcFailure("supplier_list", error);
  return Response.json({ suppliers: data ?? [] }, { headers: NO_STORE });
}

const supplierSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  trn: z.string().trim().max(20).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
  archived: z.boolean().optional(),
});

/** Stage 2D: add or edit a supplier (archive and restore too). */
export async function PUT(request: Request) {
  const parsed = supplierSchema.safeParse(await readJson(request));
  if (!parsed.success) return purchasingRefusal("invalid_supplier");
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId } = auth.session;
  const { error } = await supabase.rpc("supplier_save", { p_business_id: businessId, p_supplier: parsed.data });
  if (error) return purchasingRpcFailure("supplier_save", error);
  return new Response(null, { status: 204, headers: NO_STORE });
}
