import type { DemoState } from "../domain.ts";
import type { CountryCode, CurrencyCode } from "../fiscal/countries.ts";

export type BusinessProfile = { id: string; legalName: string; trn: string; address: string; phone: string; invoicePrefix: string; receiptFooter: string; country: CountryCode; currency: CurrencyCode };
export type TillDevice = { id: string; name: string; tillNumber: number; branchId: string; branchName: string; status: "active" | "revoked" };
export type ShopSnapshot = { business: BusinessProfile; devices: TillDevice[]; state: DemoState; generatedAt: string };

type Money = { net_fils: number; vat_fils: number; gross_fils: number };
type LineRow = Money & { id: string; product_id: string | null; description: string; sku: string | null; quantity: number; unit_gross_fils: number; list_unit_gross_fils?: number | null };

export type SnapshotRows = {
  business: { id: string; legal_name: string; trn: string; address: string; phone: string; invoice_prefix: string; receipt_footer: string; country: string; currency: string };
  devices: { id: string; name: string; till_number: number; branch_id: string; status: string; branch?: { name: string } | null }[];
  products: { id: string; name: string; sku: string; barcode: string | null; price_fils: number; stock_quantity: number; low_stock_threshold: number; status: string; tax_category?: string | null }[];
  customers: { id: string; name: string; phone: string; email: string | null; address: string | null; trn: string | null; created_at: string; updated_at: string }[];
  sales: (Money & { id: string; device_id: string; invoice_number: string; created_at: string; supply_date: string; payment_method: "cash" | "card"; status: string; customer_snapshot: Record<string, unknown> | null; supplier_snapshot: Record<string, unknown> | null; sale_items: LineRow[] })[];
  creditNotes: (Money & { id: string; device_id: string; credit_note_number: string; sale_id: string; payment_method: "cash" | "card"; created_at: string; sales: { invoice_number: string } | null; credit_note_items: (LineRow & { sale_item_id: string })[] })[];
  stockMovements: { id: string; product_id: string; type: string; quantity_delta: number; reason: string; created_at: string }[];
  register: null | { id: string; status: "open" | "closed"; opened_at: string; opening_cash_fils: number; closed_at: string | null; counted_cash_fils: number | null; expected_cash_fils: number | null; variance_fils: number | null; cash_movements: { id: string; type: string; amount_fils: number; reason: string; created_at: string }[] };
};
