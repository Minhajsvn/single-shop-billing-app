import type { DemoState } from "../domain.ts";
import type { CountryCode, CurrencyCode } from "../fiscal/countries.ts";
import type { ScaleLabelSettings } from "../weighing/types.ts";

export type BusinessProfile = { id: string; legalName: string; trn: string; address: string; phone: string; invoicePrefix: string; receiptFooter: string; country: CountryCode; currency: CurrencyCode };
export type TillDevice = { id: string; name: string; tillNumber: number; branchId: string; branchName: string; status: "active" | "paused" | "revoked" };
export type MemberRole = "owner" | "manager" | "cashier";
/** A member as the till sees them for the PIN lock (spec 2A §4.5). Hashes come only to the owner's session. */
export type StaffMember = { memberId: string; displayName: string; role: MemberRole; status: "active" | "disabled"; pinHash: string | null; pinSalt: string | null };
export type LockSettings = { pinLockEnabled: boolean; idleLockMinutes: number; managerDiscountPct: number };
export const DEFAULT_LOCK_SETTINGS: LockSettings = { pinLockEnabled: false, idleLockMinutes: 5, managerDiscountPct: 10 };
export type ShopSnapshot = { business: BusinessProfile; devices: TillDevice[]; role: MemberRole | null; state: DemoState; generatedAt: string; lockSettings: LockSettings; staff: StaffMember[]; scaleLabel: ScaleLabelSettings };

type Money = { net_fils: number; vat_fils: number; gross_fils: number };
type PaymentRow = { id: string; method: string; amount_fils: number; reference: string | null };
type LineRow = Money & { id: string; product_id: string | null; description: string; sku: string | null; quantity: number; unit_gross_fils: number; list_unit_gross_fils?: number | null; promotion_id?: string | null; promotion_saving_fils?: number | null; weight_grams?: number | null };

export type SnapshotRows = {
  role: string | null;
  /** Stage 2A. Absent from an older server: the lock is off. lock_allowed is false when the plan lacks staff_roles. */
  lock?: { pin_lock_enabled: boolean; idle_lock_minutes: number; manager_discount_pct: number; lock_allowed: boolean } | null;
  /** Owner sessions only (staff_list); empty for everyone else. */
  staff?: { member_id: string; display_name: string | null; role: string; status: string; pin_hash: string | null; pin_salt: string | null }[];
  business: { id: string; legal_name: string; trn: string; address: string; phone: string; invoice_prefix: string; receipt_footer: string; country: string; currency: string; scale_label?: unknown };
  devices: { id: string; name: string; till_number: number; branch_id: string; status: string; branch?: { name: string } | null }[];
  products: { id: string; name: string; sku: string; barcode: string | null; price_fils: number; stock_quantity: number; low_stock_threshold: number; status: string; tax_category?: string | null; category_id?: string | null; sold_by_weight?: boolean | null; scale_code?: number | null }[];
  /** Stage 2C. Absent from an older server. */
  categories?: { id: string; name: string; sort_order: number; archived_at: string | null }[];
  /** Stage 2E. Absent from an older server. Numeric columns may arrive as strings. */
  promotions?: { id: string; name: string; kind: string; target_type: string; target_id: string | null; percent: number | string | null; amount_fils: number | string | null; buy_qty: number | null; get_qty: number | null; bundle_price_fils: number | string | null; min_basket_fils: number | string | null; starts_on: string; ends_on: string | null; days: number[] | null; from_time: string | null; to_time: string | null; active: boolean; archived_at: string | null; created_at: string }[];
  customers: { id: string; name: string; phone: string; email: string | null; address: string | null; trn: string | null; created_at: string; updated_at: string }[];
  sales: (Money & { id: string; device_id: string; invoice_number: string; created_at: string; supply_date: string; payment_method: string; status: string; sale_payments?: PaymentRow[]; customer_snapshot: Record<string, unknown> | null; supplier_snapshot: Record<string, unknown> | null; sale_items: LineRow[] })[];
  creditNotes: (Money & { id: string; device_id: string; credit_note_number: string; sale_id: string; payment_method: string; credit_note_payments?: PaymentRow[]; created_at: string; sales: { invoice_number: string } | null; credit_note_items: (LineRow & { sale_item_id: string })[] })[];
  stockMovements: { id: string; product_id: string; type: string; quantity_delta: number; reason: string; created_at: string }[];
  register: null | { id: string; status: "open" | "closed"; opened_at: string; opening_cash_fils: number; closed_at: string | null; counted_cash_fils: number | null; expected_cash_fils: number | null; variance_fils: number | null; cash_movements: { id: string; type: string; amount_fils: number; reason: string; created_at: string }[] };
};
