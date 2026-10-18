import { formatMoney, splitVatInclusive, type TaxCategory } from "./fiscal/countries.ts";

export type Product = {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  priceFils: number;
  stock: number;
  lowStockThreshold: number;
  active: boolean;
  /** Stored only (Stage 1D): checkout, invoices and reports still charge standard VAT on every product. */
  taxCategory: TaxCategory;
};

export type StockMovement = {
  id: string;
  productId: string;
  delta: number;
  type: "opening" | "receipt" | "correction-in" | "correction-out" | "sale" | "return" | "import-count";
  reason: string;
  createdAt: string;
};

export type PaymentMethod = "cash" | "card";

export type Customer = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  trn?: string;
  createdAt: string;
  updatedAt: string;
};

export type CustomerSnapshot = Pick<Customer, "id" | "name" | "phone" | "email" | "address" | "trn">;

export type SupplierSnapshot = { name: string; trn: string; address: string; phone: string };

export type InvoiceLine = {
  id: string;
  productId?: string;
  name: string;
  sku?: string;
  quantity: number;
  unitGrossFils: number;
  /** Undiscounted unit price, present only when the line was discounted. */
  listUnitGrossFils?: number;
  netFils: number;
  vatFils: number;
  grossFils: number;
};

export type Sale = {
  id: string;
  invoiceNumber: string;
  createdAt: string;
  supplyDate: string;
  paymentMethod: PaymentMethod;
  lines: InvoiceLine[];
  netFils: number;
  vatFils: number;
  grossFils: number;
  customer?: CustomerSnapshot;
  supplier?: SupplierSnapshot;
  /** The till that issued the invoice (hosted shops only). */
  deviceId?: string;
  status: "completed";
};

export type CreditNoteLine = InvoiceLine & {
  originalLineId: string;
};

export type CreditNote = {
  id: string;
  creditNoteNumber: string;
  saleId: string;
  invoiceNumber: string;
  createdAt: string;
  paymentMethod: PaymentMethod;
  lines: CreditNoteLine[];
  netFils: number;
  vatFils: number;
  grossFils: number;
  /** The till that issued the credit note (hosted shops only). */
  deviceId?: string;
};

export type CustomerSyncPayload = { customer: Customer };
export type SaleSyncPayload = { sale: Sale; register?: RegisterSession | null };
export type RegisterSyncPayload =
  | { action: "open"; register: RegisterSession }
  | { action: "adjustment"; registerId: string; adjustment: CashAdjustment; register?: RegisterSession | null }
  | { action: "close"; register: RegisterSession };
export type CreditNoteSyncPayload = { creditNote: CreditNote };
/** The product without stock: stock only ever changes through stock movements, sales and refunds. */
export type ProductRecord = Omit<Product, "stock">;
export type ProductSyncPayload = { product: ProductRecord };
/**
 * product: a full copy, sent only by operations queued before Stage 1D (newer clients queue a product operation first).
 * countedStock: the stock an import counted; the server sets stock to it and records the difference.
 */
export type StockSyncPayload = { movement: StockMovement; product?: Product; countedStock?: number };
/** The till that created the operation; the server books the work to this device. Absent on operations queued before Stage 1B. */
export type DeviceTag = { deviceId?: string };
export type SyncPayload = (CustomerSyncPayload | SaleSyncPayload | RegisterSyncPayload | CreditNoteSyncPayload | StockSyncPayload | ProductSyncPayload) & DeviceTag;

export type SyncOperation = {
  id: string;
  entity: "sale" | "credit-note" | "customer" | "register" | "stock" | "product";
  entityId: string;
  createdAt: string;
  status: "pending" | "synced" | "failed";
  error?: string;
  payload?: SyncPayload;
};

export type CashAdjustment = {
  id: string;
  amountFils: number;
  reason: string;
  createdAt: string;
};

export type RegisterSession = {
  id: string;
  status: "open" | "closed";
  openedAt: string;
  openingCashFils: number;
  adjustments: CashAdjustment[];
  closedAt?: string;
  countedCashFils?: number;
  expectedCashFils?: number;
  varianceFils?: number;
};

export type DemoState = {
  products: Product[];
  stockMovements: StockMovement[];
  sales: Sale[];
  customers: Customer[];
  creditNotes: CreditNote[];
  syncOperations: SyncOperation[];
  register: RegisterSession | null;
};

export const initialProducts: Product[] = [
  { id: "prd-001", name: "Arabic Coffee 250g", sku: "COF-250", barcode: "6291100211014", priceFils: 2850, stock: 18, lowStockThreshold: 6, active: true, taxCategory: "standard" },
  { id: "prd-002", name: "Saffron Tea Selection", sku: "TEA-SAF", barcode: "6291100211021", priceFils: 4200, stock: 4, lowStockThreshold: 5, active: true, taxCategory: "standard" },
  { id: "prd-003", name: "Date Syrup 400ml", sku: "DAT-400", barcode: "6291100211038", priceFils: 1850, stock: 9, lowStockThreshold: 4, active: true, taxCategory: "standard" },
  { id: "prd-004", name: "Ceramic Serving Cup", sku: "CUP-CRM", barcode: "6291100211045", priceFils: 3200, stock: 3, lowStockThreshold: 4, active: true, taxCategory: "standard" },
  { id: "prd-005", name: "Premium Date Box", sku: "DAT-PRM", barcode: "6291100211052", priceFils: 6800, stock: 12, lowStockThreshold: 5, active: true, taxCategory: "standard" },
];

export function formatAED(fils: number) {
  return formatMoney(fils, "AED");
}

export function calculateVatInclusive(grossFils: number, rateBp = 500) {
  return splitVatInclusive(grossFils, rateBp);
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-AE", {
    timeZone: "Asia/Dubai",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-AE", {
    timeZone: "Asia/Dubai",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
