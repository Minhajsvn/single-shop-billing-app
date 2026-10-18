import { mapSaleRow } from "@/lib/snapshot/map-rows";
import type { SnapshotRows } from "@/lib/snapshot/types";
import { ownerBusiness } from "@/lib/sales/owner-business";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One sale, for viewing and reprinting an invoice older than the browser's 90-day history (owner only). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "Sale not found." }, { status: 404 });
  const owner = await ownerBusiness();
  if (!owner.ok) return Response.json({ error: owner.error }, { status: owner.status });

  const { data, error } = await owner.supabase.rpc("get_sale_detail", { p_business_id: owner.businessId, p_sale_id: id });
  if (error) return Response.json({ error: error.message }, { status: error.message.includes("not_authorized") ? 403 : 502 });
  if (!data) return Response.json({ error: "Sale not found." }, { status: 404 });
  return Response.json({ sale: mapSaleRow(data as SnapshotRows["sales"][number]) });
}
