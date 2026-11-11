import { z } from "zod";
import { readJson, staffSession } from "@/lib/staff/route";
import { DATE, NO_STORE, UUID, purchasingRefusal, purchasingRpcFailure } from "@/lib/purchasing/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Stage 2D: deliveries between two invoice dates (at most 92 days), optionally one supplier's. */
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const from = search.get("from") ?? "";
  const to = search.get("to") ?? "";
  const supplier = search.get("supplier");
  if (!DATE.test(from) || !DATE.test(to)) return purchasingRefusal("invalid_range");
  if (supplier && !UUID.test(supplier)) return purchasingRefusal("supplier_not_found");
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId } = auth.session;
  const { data, error } = await supabase.rpc("purchase_receipt_list", { p_business_id: businessId, p_from: from, p_to: to, p_supplier: supplier ?? null });
  if (error) return purchasingRpcFailure("purchase_receipt_list", error);
  return Response.json({ receipts: data ?? [] }, { headers: NO_STORE });
}

const receiptSchema = z.object({
  id: z.string().uuid(),
  supplierId: z.string().uuid(),
  supplierInvoice: z.string().trim().min(1).max(40).optional(),
  invoiceDate: z.string().regex(DATE),
  vatFils: z.number().int().min(0),
  note: z.string().trim().max(300).optional(),
  lines: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(100_000),
    unitCostFils: z.number().int().min(0).max(100_000_000),
  })).min(1).max(200),
});

/** Stage 2D: record a delivery. The same id again returns the saved delivery. */
export async function POST(request: Request) {
  const parsed = receiptSchema.safeParse(await readJson(request));
  if (!parsed.success) return purchasingRefusal("invalid_receipt");
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId } = auth.session;
  const { data, error } = await supabase.rpc("record_purchase_receipt", { p_business_id: businessId, p_receipt: parsed.data });
  if (error) return purchasingRpcFailure("record_purchase_receipt", error);
  return Response.json(data, { headers: NO_STORE });
}
