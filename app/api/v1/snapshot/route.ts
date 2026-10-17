import { createServerSupabaseClient } from "@/lib/supabase/server";
import { mapSnapshotRows } from "@/lib/snapshot/map-rows";
import type { SnapshotRows } from "@/lib/snapshot/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HISTORY_DAYS = 90;
const PAGE = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Page = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

// PostgREST caps responses at max_rows (1000); page until a short page comes back.
async function fetchAll(query: (from: number, to: number) => Page) {
  const data: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = await query(from, from + PAGE - 1);
    if (page.error) return { data: null, error: page.error };
    const batch = page.data ?? [];
    data.push(...batch);
    if (batch.length < PAGE) return { data, error: null };
  }
}

export async function GET(request: Request) {
  const deviceParam = new URL(request.url).searchParams.get("deviceId");
  if (deviceParam !== null && !UUID.test(deviceParam)) return Response.json({ error: "deviceId must be a UUID." }, { status: 400 });
  const deviceId = deviceParam;
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Authentication is required." }, { status: 401 });

    const { data: membership, error: membershipError } = await supabase.from("business_members").select("business_id").eq("user_id", user.id).eq("status", "active").limit(1).maybeSingle();
    if (membershipError) return Response.json({ error: membershipError.message }, { status: 502 });
    if (!membership) return Response.json({ error: "No business is configured for this account." }, { status: 404 });
    const businessId = membership.business_id as string;
    const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();

    const [business, devices, products, customers, sales, creditNotes, stockMovements, register] = await Promise.all([
      supabase.from("businesses").select("id, legal_name, trn, address, phone, invoice_prefix, receipt_footer, country, currency").eq("id", businessId).single(),
      supabase.from("devices").select("id, name, till_number, branch_id, status").eq("business_id", businessId),
      fetchAll((from, to) => supabase.from("products").select("id, name, sku, barcode, price_fils, stock_quantity, low_stock_threshold, status, tax_category").eq("business_id", businessId).order("name").order("id").range(from, to)),
      fetchAll((from, to) => supabase.from("customers").select("id, name, phone, email, address, trn, created_at, updated_at").eq("business_id", businessId).order("created_at", { ascending: false }).order("id").range(from, to)),
      fetchAll((from, to) => supabase.from("sales").select("id, device_id, invoice_number, created_at, supply_date, payment_method, net_fils, vat_fils, gross_fils, status, customer_snapshot, supplier_snapshot, sale_items!sale_items_sale_id_fkey(id, product_id, description, sku, quantity, unit_gross_fils, list_unit_gross_fils, net_fils, vat_fils, gross_fils)").eq("business_id", businessId).gte("created_at", since).order("created_at", { ascending: false }).order("id").range(from, to)),
      fetchAll((from, to) => supabase.from("credit_notes").select("id, device_id, credit_note_number, sale_id, payment_method, created_at, sales!credit_notes_sale_id_fkey(invoice_number), net_fils, vat_fils, gross_fils, credit_note_items!credit_note_items_credit_note_id_fkey(id, sale_item_id, product_id, description, sku, quantity, unit_gross_fils, net_fils, vat_fils, gross_fils)").eq("business_id", businessId).gte("created_at", since).order("created_at", { ascending: false }).order("id").range(from, to)),
      fetchAll((from, to) => supabase.from("stock_movements").select("id, product_id, type, quantity_delta, reason, created_at").eq("business_id", businessId).gte("created_at", since).order("created_at", { ascending: false }).order("id").range(from, to)),
      deviceId
        ? supabase.from("register_sessions").select("id, status, opened_at, opening_cash_fils, closed_at, counted_cash_fils, expected_cash_fils, variance_fils, cash_movements(id, type, amount_fils, reason, created_at)").eq("business_id", businessId).eq("device_id", deviceId).order("opened_at", { ascending: false }).limit(1).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const failed = [business, devices, products, customers, sales, creditNotes, stockMovements, register].find((result) => result.error);
    if (failed?.error) return Response.json({ error: failed.error.message }, { status: 502 });

    const rows = {
      business: business.data, devices: devices.data ?? [], products: products.data ?? [], customers: customers.data ?? [],
      sales: sales.data ?? [], creditNotes: creditNotes.data ?? [], stockMovements: stockMovements.data ?? [], register: register.data ?? null,
    } as unknown as SnapshotRows;
    return Response.json(mapSnapshotRows(rows, new Date().toISOString()));
  } catch {
    return Response.json({ error: "The shop snapshot could not be loaded." }, { status: 503 });
  }
}
