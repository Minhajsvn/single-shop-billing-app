import type { CustomerSnapshot, DemoState, InvoiceLine, Sale, StockMovement, SupplierSnapshot } from "../domain.ts";
import type { CountryCode, CurrencyCode, TaxCategory } from "../fiscal/countries.ts";
import type { ShopSnapshot, SnapshotRows } from "./types.ts";

const optional = (value: string | null) => value ?? undefined;

function mapLine(row: SnapshotRows["sales"][number]["sale_items"][number]): InvoiceLine {
  return {
    id: row.id, productId: optional(row.product_id), name: row.description, sku: optional(row.sku), quantity: row.quantity,
    unitGrossFils: Number(row.unit_gross_fils), netFils: Number(row.net_fils), vatFils: Number(row.vat_fils), grossFils: Number(row.gross_fils),
    listUnitGrossFils: row.list_unit_gross_fils == null ? undefined : Number(row.list_unit_gross_fils),
  };
}

/** Rows written before Stage 1D (or by an older server) have no category: they are standard-rated. */
function taxCategory(value: string | null | undefined): TaxCategory {
  return value === "zero" || value === "exempt" ? value : "standard";
}

/** One sale row (with its items) as the app's Sale; also used for old sales fetched one at a time. */
export function mapSaleRow(s: SnapshotRows["sales"][number]): Sale {
  return {
    id: s.id, deviceId: s.device_id, invoiceNumber: s.invoice_number, createdAt: s.created_at, supplyDate: s.supply_date, paymentMethod: s.payment_method,
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
      id: p.id, name: p.name, sku: p.sku, barcode: optional(p.barcode), priceFils: Number(p.price_fils), stock: p.stock_quantity, lowStockThreshold: p.low_stock_threshold, active: p.status === "active", taxCategory: taxCategory(p.tax_category),
    })),
    customers: rows.customers.map((c) => ({
      id: c.id, name: c.name, phone: c.phone, email: optional(c.email), address: optional(c.address), trn: optional(c.trn), createdAt: c.created_at, updatedAt: c.updated_at,
    })),
    sales: rows.sales.map(mapSaleRow),
    creditNotes: rows.creditNotes.map((n) => ({
      id: n.id, deviceId: n.device_id, creditNoteNumber: n.credit_note_number, saleId: n.sale_id, invoiceNumber: n.sales?.invoice_number ?? invoiceBySale.get(n.sale_id) ?? "", createdAt: n.created_at, paymentMethod: n.payment_method,
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
  };
}
