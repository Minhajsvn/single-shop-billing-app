import { createServerSupabaseClient } from "@/lib/supabase/server";
import { activeMembership } from "@/lib/access/membership";
import { mapSaleRow } from "@/lib/snapshot/map-rows";
import type { SnapshotRows } from "@/lib/snapshot/types";
import type { InvoiceLookupCreditNote } from "@/lib/sales/invoice-lookup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NOT_FOUND = "No sale with that invoice number.";

type Row = SnapshotRows["sales"][number] & {
  credit_notes?: { id: string; credit_note_number: string; created_at: string; gross_fils: number; credit_note_items: { sale_item_id: string; quantity: number }[] }[];
};

/**
 * One sale by its whole invoice number (case and surrounding spaces ignored, as on the till), for any member of the shop (owner decision 8: a cashier refunds a returning
 * customer's sale from the receipt). No partial matches or browsing; every lookup is audited by the server function.
 */
export async function GET(request: Request) {
  const invoice = new URL(request.url).searchParams.get("invoice")?.trim() ?? "";
  if (!invoice || invoice.length > 64) return Response.json({ error: NOT_FOUND }, { status: 404 });
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Authentication is required." }, { status: 401 });
    const { data: membership, error: memberError } = await activeMembership(supabase, user.id);
    if (memberError) return Response.json({ error: memberError.message }, { status: 502 });
    if (!membership) return Response.json({ error: "No business is configured for this account." }, { status: 404 });

    const { data, error } = await supabase.rpc("find_sale_by_invoice", { p_business_id: membership.business_id, p_invoice: invoice });
    if (error) return Response.json({ error: error.message.includes("not_authorized") ? "Not allowed." : error.message }, { status: error.message.includes("not_authorized") ? 403 : 502 });
    if (!data) return Response.json({ error: NOT_FOUND }, { status: 404 });
    const row = data as Row;
    const creditNotes: InvoiceLookupCreditNote[] = (row.credit_notes ?? []).map((note) => ({
      id: note.id, creditNoteNumber: note.credit_note_number, createdAt: note.created_at, grossFils: Number(note.gross_fils),
      lines: note.credit_note_items.map((item) => ({ saleItemId: item.sale_item_id, quantity: Number(item.quantity) })),
    }));
    return Response.json({ sale: mapSaleRow(row), creditNotes });
  } catch {
    return Response.json({ error: "The sale could not be loaded." }, { status: 503 });
  }
}
