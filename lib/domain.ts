export type Product = {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  priceFils: number;
  stock: number;
  lowStockThreshold: number;
  active: boolean;
};

export type StockMovement = {
  id: string;
  productId: string;
  delta: number;
  type: "opening" | "receipt" | "correction-in" | "correction-out" | "sale" | "return";
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

export type InvoiceLine = {
  id: string;
  productId?: string;
  name: string;
  sku?: string;
  quantity: number;
  unitGrossFils: number;
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
};

export type SyncOperation = {
  id: string;
  entity: "sale" | "credit-note" | "customer" | "register" | "stock";
  entityId: string;
  createdAt: string;
  status: "pending" | "synced" | "failed";
  error?: string;
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
  { id: "prd-001", name: "Arabic Coffee 250g", sku: "COF-250", barcode: "6291100211014", priceFils: 2850, stock: 18, lowStockThreshold: 6, active: true },
  { id: "prd-002", name: "Saffron Tea Selection", sku: "TEA-SAF", barcode: "6291100211021", priceFils: 4200, stock: 4, lowStockThreshold: 5, active: true },
  { id: "prd-003", name: "Date Syrup 400ml", sku: "DAT-400", barcode: "6291100211038", priceFils: 1850, stock: 9, lowStockThreshold: 4, active: true },
  { id: "prd-004", name: "Ceramic Serving Cup", sku: "CUP-CRM", barcode: "6291100211045", priceFils: 3200, stock: 3, lowStockThreshold: 4, active: true },
  { id: "prd-005", name: "Premium Date Box", sku: "DAT-PRM", barcode: "6291100211052", priceFils: 6800, stock: 12, lowStockThreshold: 5, active: true },
];

export function formatAED(fils: number) {
  return new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(fils / 100);
}

export function calculateVatInclusive(grossFils: number) {
  const netFils = Math.round((grossFils * 100) / 105);
  return { netFils, vatFils: grossFils - netFils, grossFils };
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
