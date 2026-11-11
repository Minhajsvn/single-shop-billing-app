import { createServerSupabaseClient } from "@/lib/supabase/server";
import { activeMembership } from "@/lib/access/membership";
import { mapSnapshotRows } from "@/lib/snapshot/map-rows";
import type { SnapshotRows } from "@/lib/snapshot/types";
import { hasFeature, parseEntitlements } from "@/lib/billing/entitlements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HISTORY_DAYS = 90;
const PAGE = 1000;
/** No date window: for non-owners the rows are whatever row security returns. */
const ALL_TIME = "1970-01-01T00:00:00.000Z";
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

    const { data: membership, error: membershipError } = await activeMembership(supabase, user.id);
    if (membershipError) return Response.json({ error: membershipError.message }, { status: 502 });
    if (!membership) return Response.json({ error: "No business is configured for this account." }, { status: 404 });
    const businessId = membership.business_id as string;
    // Owners get the last 90 days. Other members read only what selling needs: row security already limits their sales
    // and credit notes to today's (Dubai) and the open shift's, so no date window applies, and stock movements are left out.
    const owner = membership.role === "owner";
    const since = owner ? new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString() : ALL_TIME;

    const [business, devices, products, categories, promotions, customers, sales, creditNotes, stockMovements, register, staff, entitlements] = await Promise.all([
      supabase.from("businesses").select("id, legal_name, trn, address, phone, invoice_prefix, receipt_footer, country, currency, pin_lock_enabled, idle_lock_minutes, manager_discount_pct, scale_label").eq("id", businessId).single(),
      supabase.from("devices").select("id, name, till_number, branch_id, status, branch:branches(name)").eq("business_id", businessId),
      fetchAll((from, to) => supabase.from("products").select("id, name, sku, barcode, price_fils, stock_quantity, low_stock_threshold, status, tax_category, category_id, sold_by_weight, scale_code").eq("business_id", businessId).order("name").order("id").range(from, to)),
      fetchAll((from, to) => supabase.from("product_categories").select("id, name, sort_order, archived_at").eq("business_id", businessId).order("sort_order").order("id").range(from, to)),
      // Stage 2E: every member's till gets the live promotions (row security hides archived and ended ones).
      fetchAll((from, to) => supabase.from("promotions").select("id, name, kind, target_type, target_id, percent, amount_fils, buy_qty, get_qty, bundle_price_fils, min_basket_fils, starts_on, ends_on, days, from_time, to_time, active, archived_at, created_at").eq("business_id", businessId).order("created_at").order("id").range(from, to)),
      fetchAll((from, to) => supabase.from("customers").select("id, name, phone, email, address, trn, created_at, updated_at").eq("business_id", businessId).order("created_at", { ascending: false }).order("id").range(from, to)),
      fetchAll((from, to) => supabase.from("sales").select("id, device_id, invoice_number, created_at, supply_date, payment_method, net_fils, vat_fils, gross_fils, status, customer_snapshot, supplier_snapshot, sale_payments(id, method, amount_fils, reference), sale_items!sale_items_sale_id_fkey(id, product_id, description, sku, quantity, unit_gross_fils, list_unit_gross_fils, promotion_id, promotion_saving_fils, weight_grams, net_fils, vat_fils, gross_fils)").eq("business_id", businessId).gte("created_at", since).order("created_at", { ascending: false }).order("id").range(from, to)),
      fetchAll((from, to) => supabase.from("credit_notes").select("id, device_id, credit_note_number, sale_id, payment_method, created_at, sales!credit_notes_sale_id_fkey(invoice_number), net_fils, vat_fils, gross_fils, credit_note_payments(id, method, amount_fils, reference), credit_note_items!credit_note_items_credit_note_id_fkey(id, sale_item_id, product_id, description, sku, quantity, unit_gross_fils, weight_grams, net_fils, vat_fils, gross_fils)").eq("business_id", businessId).gte("created_at", since).order("created_at", { ascending: false }).order("id").range(from, to)),
      owner
        ? fetchAll((from, to) => supabase.from("stock_movements").select("id, product_id, type, quantity_delta, reason, created_at").eq("business_id", businessId).gte("created_at", since).order("created_at", { ascending: false }).order("id").range(from, to))
        : Promise.resolve({ data: [] as unknown[], error: null }),
      deviceId
        ? supabase.from("register_sessions").select("id, status, opened_at, opening_cash_fils, closed_at, counted_cash_fils, expected_cash_fils, variance_fils, cash_movements(id, type, amount_fils, reason, created_at)").eq("business_id", businessId).eq("device_id", deviceId).order("opened_at", { ascending: false }).limit(1).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      // Stage 2A: the PIN hashes come only to the owner's session (staff_list refuses anyone else).
      owner ? supabase.rpc("staff_list", { p_business_id: businessId }) : Promise.resolve({ data: [] as unknown[], error: null }),
      supabase.rpc("business_entitlements", { target_business_id: businessId }),
    ]);

    const failed = [business, devices, products, categories, promotions, customers, sales, creditNotes, stockMovements, register, staff].find((result) => result.error);
    if (failed?.error) return Response.json({ error: failed.error.message }, { status: 502 });

    const shop = business.data as Record<string, unknown>;
    // An entitlement read failure keeps the lock off rather than failing the whole snapshot.
    let lockAllowed = false;
    try {
      lockAllowed = !entitlements.error && hasFeature(parseEntitlements(entitlements.data), "staff_roles");
    } catch {
      lockAllowed = false;
    }
    const rows = {
      role: membership.role, business: business.data, devices: devices.data ?? [], products: products.data ?? [], categories: categories.data ?? [], promotions: promotions.data ?? [], customers: customers.data ?? [],
      sales: sales.data ?? [], creditNotes: creditNotes.data ?? [], stockMovements: stockMovements.data ?? [], register: register.data ?? null,
      lock: { pin_lock_enabled: shop.pin_lock_enabled === true, idle_lock_minutes: Number(shop.idle_lock_minutes ?? 5), manager_discount_pct: Number(shop.manager_discount_pct ?? 10), lock_allowed: lockAllowed },
      staff: staff.data ?? [],
    } as unknown as SnapshotRows;
    return Response.json(mapSnapshotRows(rows, new Date().toISOString()));
  } catch {
    return Response.json({ error: "The shop snapshot could not be loaded." }, { status: 503 });
  }
}
