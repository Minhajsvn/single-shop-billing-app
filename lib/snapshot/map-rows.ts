import type { CustomerSnapshot, DemoState, InvoiceLine, Payment, PaymentMethod, Sale, StockMovement, SupplierSnapshot } from "../domain.ts";
import type { CountryCode, CurrencyCode, TaxCategory } from "../fiscal/countries.ts";
import type { Promotion } from "../promotions/types.ts";
import { normalizeScaleLabel } from "../weighing/types.ts";
import { DEFAULT_LOCK_SETTINGS, type LockSettings, type ShopSnapshot, type SnapshotRows, type StaffMember } from "./types.ts";

/** Stage 2A lock settings; off when the server sends none or the plan does not include staff_roles. */
function mapLock(lock: SnapshotRows["lock"]): LockSettings {
  if (!lock) return DEFAULT_LOCK_SETTINGS;
  return { pinLockEnabled: lock.pin_lock_enabled && lock.lock_allowed, idleLockMinutes: Number(lock.idle_lock_minutes), managerDiscountPct: Number(lock.manager_discount_pct) };
}

function mapStaff(rows: SnapshotRows["staff"]): StaffMember[] {
  return (rows ?? []).map((m) => ({
    memberId: m.member_id,
    displayName: m.display_name?.trim() || "Staff member",
    role: m.role === "owner" || m.role === "manager" ? m.role : "cashier",
    status: m.status === "active" ? "active" : "disabled",
    pinHash: m.pin_hash,
    pinSalt: m.pin_salt,
  }));
}

const optional = (value: string | null) => value ?? undefined;

/** Stage 2B payment rows; undefined when the server sent none (older server or record). */
function mapPayments(rows: { id: string; method: string; amount_fils: number; reference: string | null }[] | undefined): Payment[] | undefined {
  if (!rows?.length) return undefined;
  return rows.map((p) => ({ id: p.id, method: p.method === "card" || p.method === "transfer" ? p.method : "cash", amountFils: Number(p.amount_fils), ...(p.reference ? { reference: p.reference } : {}) }));
}

function summary(value: string): PaymentMethod {
  return value === "card" || value === "transfer" || value === "split" ? value : "cash";
}

const numberOrNull = (value: number | string | null) => (value === null || value === undefined ? null : Number(value));
const hhmm = (value: string | null) => (value ? value.slice(0, 5) : null);

/** Stage 2E: a promotions row as the till's Promotion. */
function mapPromotion(p: NonNullable<SnapshotRows["promotions"]>[number]): Promotion {
  return {
    id: p.id, name: p.name, kind: p.kind as Promotion["kind"], targetType: p.target_type as Promotion["targetType"], targetId: p.target_id,
    percent: numberOrNull(p.percent), amountFils: numberOrNull(p.amount_fils), buyQty: p.buy_qty, getQty: p.get_qty,
    bundlePriceFils: numberOrNull(p.bundle_price_fils), minBasketFils: numberOrNull(p.min_basket_fils),
    startsOn: p.starts_on, endsOn: p.ends_on, days: p.days, fromTime: hhmm(p.from_time), toTime: hhmm(p.to_time),
    active: p.active, archived: p.archived_at !== null, createdAt: p.created_at,
  };
}

function mapLine(row: SnapshotRows["sales"][number]["sale_items"][number]): InvoiceLine {
  return {
    id: row.id, productId: optional(row.product_id), name: row.description, sku: optional(row.sku), quantity: row.quantity,
    unitGrossFils: Number(row.unit_gross_fils), netFils: Number(row.net_fils), vatFils: Number(row.vat_fils), grossFils: Number(row.gross_fils),
    listUnitGrossFils: row.list_unit_gross_fils == null ? undefined : Number(row.list_unit_gross_fils),
    ...(row.promotion_id ? { promotionId: row.promotion_id, promotionSavingFils: Number(row.promotion_saving_fils ?? 0) } : {}),
    ...(row.weight_grams ? { weightGrams: Number(row.weight_grams) } : {}),
  };
}

/** Rows written before Stage 1D (or by an older server) have no category: they are standard-rated. */
function taxCategory(value: string | null | undefined): TaxCategory {
  return value === "zero" || value === "exempt" ? value : "standard";
}

/** One sale row (with its items) as the app's Sale; also used for old sales fetched one at a time. */
export function mapSaleRow(s: SnapshotRows["sales"][number]): Sale {
  return {
    id: s.id, deviceId: s.device_id, invoiceNumber: s.invoice_number, createdAt: s.created_at, supplyDate: s.supply_date, paymentMethod: summary(s.payment_method), payments: mapPayments(s.sale_payments),
    lines: s.sale_items.map(mapLine), netFils: Number(s.net_fils), vatFils: Number(s.vat_fils), grossFils: Number(s.gross_fils),
    customer: (s.customer_snapshot ?? undefined) as CustomerSnapshot | undefined,
    supplier: (s.supplier_snapshot ?? undefined) as SupplierSnapshot | undefined,
    status: "completed" as const,
  };
}

export function mapSnapshotRows(rows: SnapshotRows, generatedAt: string): ShopSnapshot {
  const invoiceBySale = new Map(rows.sales.map((sale) => [sale.id, sale.invoice_number]));
  const state: DemoState = {
    products: rows.products.map((p) => ({
      id: p.id, name: p.name, sku: p.sku, barcode: optional(p.barcode), priceFils: Number(p.price_fils), stock: p.stock_quantity, lowStockThreshold: p.low_stock_threshold, active: p.status === "active", taxCategory: taxCategory(p.tax_category), categoryId: p.category_id ?? null,
      soldByWeight: p.sold_by_weight === true, scaleCode: p.scale_code == null ? null : Number(p.scale_code),
    })),
    categories: (rows.categories ?? []).map((c) => ({ id: c.id, name: c.name, sortOrder: Number(c.sort_order), archived: c.archived_at !== null })),
    promotions: (rows.promotions ?? []).map(mapPromotion),
    customers: rows.customers.map((c) => ({
      id: c.id, name: c.name, phone: c.phone, email: optional(c.email), address: optional(c.address), trn: optional(c.trn), createdAt: c.created_at, updatedAt: c.updated_at,
    })),
    sales: rows.sales.map(mapSaleRow),
    creditNotes: rows.creditNotes.map((n) => ({
      id: n.id, deviceId: n.device_id, creditNoteNumber: n.credit_note_number, saleId: n.sale_id, invoiceNumber: n.sales?.invoice_number ?? invoiceBySale.get(n.sale_id) ?? "", createdAt: n.created_at, paymentMethod: summary(n.payment_method), payments: mapPayments(n.credit_note_payments),
      lines: n.credit_note_items.map((item) => ({ ...mapLine(item), originalLineId: item.sale_item_id })),
      netFils: Number(n.net_fils), vatFils: Number(n.vat_fils), grossFils: Number(n.gross_fils),
    })),
    stockMovements: rows.stockMovements.map((m) => ({
      id: m.id, productId: m.product_id, delta: m.quantity_delta, type: m.type.replace("_", "-") as StockMovement["type"], reason: m.reason, createdAt: m.created_at,
    })),
    syncOperations: [],
    register: rows.register ? {
      id: rows.register.id, status: rows.register.status, openedAt: rows.register.opened_at, openingCashFils: Number(rows.register.opening_cash_fils),
      adjustments: rows.register.cash_movements.filter((m) => m.type === "adjustment_in" || m.type === "adjustment_out")
        .map((m) => ({ id: m.id, amountFils: Number(m.amount_fils), reason: m.reason, createdAt: m.created_at })),
      closedAt: optional(rows.register.closed_at),
      countedCashFils: rows.register.counted_cash_fils === null ? undefined : Number(rows.register.counted_cash_fils),
      expectedCashFils: rows.register.expected_cash_fils === null ? undefined : Number(rows.register.expected_cash_fils),
      varianceFils: rows.register.variance_fils === null ? undefined : Number(rows.register.variance_fils),
    } : null,
  };
  return {
    business: {
      id: rows.business.id, legalName: rows.business.legal_name, trn: rows.business.trn, address: rows.business.address, phone: rows.business.phone,
      invoicePrefix: rows.business.invoice_prefix, receiptFooter: rows.business.receipt_footer, country: rows.business.country as CountryCode, currency: rows.business.currency as CurrencyCode,
    },
    devices: rows.devices.map((d) => ({ id: d.id, name: d.name, tillNumber: d.till_number, branchId: d.branch_id, branchName: d.branch?.name ?? "Main branch", status: d.status === "active" ? "active" as const : d.status === "paused" ? "paused" as const : "revoked" as const }))
      .sort((left, right) => left.tillNumber - right.tillNumber),
    role: rows.role === "owner" || rows.role === "manager" || rows.role === "cashier" ? rows.role : null,
    state,
    generatedAt,
    lockSettings: mapLock(rows.lock),
    staff: mapStaff(rows.staff),
    scaleLabel: normalizeScaleLabel(rows.business.scale_label),
  };
}
