import { z } from "zod";
import type { SaleRow } from "@/lib/lists/merge-results";
import { PAGE_SIZE } from "@/lib/lists/paging";
import { ownerBusiness } from "@/lib/sales/owner-business";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const querySchema = z.object({
  q: z.string().max(100).default(""),
  from: z.string().regex(DATE).optional(),
  to: z.string().regex(DATE),
  page: z.coerce.number().int().min(1).default(1),
});

type SearchRow = { id: string; invoice_number: string; customer_name: string | null; customer_phone: string | null; supply_date: string; created_at: string; payment_method: SaleRow["paymentMethod"]; gross_fils: number; total_count: number };

/** Owner-only search across all of the shop's sales (the browser holds only the last 90 days). */
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return Response.json({ error: "Invalid search." }, { status: 400 });
  const owner = await ownerBusiness();
  if (!owner.ok) return Response.json({ error: owner.error }, { status: owner.status });

  const { q, from, to, page } = parsed.data;
  const { data, error } = await owner.supabase.rpc("search_sales", {
    p_business_id: owner.businessId,
    p_query: q,
    p_from: from ?? null,
    p_to: to,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  if (error) return Response.json({ error: error.message }, { status: error.message.includes("not_authorized") ? 403 : 502 });

  const rows = (data ?? []) as SearchRow[];
  return Response.json({
    page,
    total: Number(rows[0]?.total_count ?? 0),
    rows: rows.map((row): SaleRow => ({
      id: row.id,
      invoiceNumber: row.invoice_number,
      ...(row.customer_name ? { customerName: row.customer_name } : {}),
      ...(row.customer_phone ? { customerPhone: row.customer_phone } : {}),
      supplyDate: row.supply_date,
      createdAt: row.created_at,
      paymentMethod: row.payment_method,
      grossFils: Number(row.gross_fils),
    })),
  });
}
