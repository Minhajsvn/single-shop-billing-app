import { staffSession } from "@/lib/staff/route";
import { NO_STORE, purchasingRpcFailure } from "@/lib/purchasing/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Stage 2D: per product, the latest delivery that was not voided (date, supplier, unit cost excl. VAT). */
export async function GET() {
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId } = auth.session;
  const { data, error } = await supabase.rpc("product_last_delivery", { p_business_id: businessId });
  if (error) return purchasingRpcFailure("product_last_delivery", error);
  const deliveries = ((data ?? []) as { product_id: string; invoice_date: string; supplier_name: string; unit_cost_fils: number }[])
    .map((row) => ({ productId: row.product_id, invoiceDate: row.invoice_date, supplierName: row.supplier_name, unitCostFils: Number(row.unit_cost_fils) }));
  return Response.json({ deliveries }, { headers: NO_STORE });
}
