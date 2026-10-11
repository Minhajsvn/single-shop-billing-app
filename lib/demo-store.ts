"use client";

import {
  calculateVatInclusive,
  initialProducts,
  type CreditNote,
  type Customer,
  type DemoState,
  type InvoiceLine,
  type PaymentMethod,
  type Product,
  type Sale,
  type StockMovement,
  type SyncOperation,
} from "@/lib/domain";
import { clearSyncedOutbox, persistOfflineSnapshot } from "@/lib/offline-db";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { useSyncExternalStore } from "react";

const STORE_KEY = "shop-ledger-demo-store-v2";
const LEGACY_PRODUCT_KEY = "shop-ledger-demo-products-v1";
const SETTINGS_KEY = "shop-ledger-demo-settings-v1";

const initialCustomers: Customer[] = [
  { id: "customer-001", name: "Mariam Trading LLC", phone: "+971 50 555 0132", email: "accounts@mariamtrading.example", address: "Al Barsha, Dubai, United Arab Emirates", trn: "100123456700003", createdAt: "2026-08-28T08:00:00.000Z", updatedAt: "2026-08-28T08:00:00.000Z" },
  { id: "customer-002", name: "Omar Hassan", phone: "+971 55 555 0198", email: "omar.hassan@example.com", createdAt: "2026-08-29T10:30:00.000Z", updatedAt: "2026-08-29T10:30:00.000Z" },
];

function line(productId: string, name: string, sku: string, quantity: number, unitGrossFils: number): InvoiceLine {
  const totals = calculateVatInclusive(unitGrossFils * quantity);
  return { id: `line-${productId}-${quantity}-${unitGrossFils}`, productId, name, sku, quantity, unitGrossFils, ...totals };
}

function seededSale(id: string, invoiceNumber: string, createdAt: string, paymentMethod: PaymentMethod, lines: InvoiceLine[]): Sale {
  return {
    id,
    invoiceNumber,
    createdAt,
    supplyDate: createdAt.slice(0, 10),
    paymentMethod,
    lines,
    netFils: lines.reduce((sum, item) => sum + item.netFils, 0),
    vatFils: lines.reduce((sum, item) => sum + item.vatFils, 0),
    grossFils: lines.reduce((sum, item) => sum + item.grossFils, 0),
    status: "completed",
  };
}

const initialState: DemoState = {
  products: initialProducts,
  stockMovements: [],
  sales: [
    seededSale("sale-001", "SL-260830-0010", "2026-08-30T07:54:00.000Z", "cash", [line("prd-005", "Premium Date Box", "DAT-PRM", 1, 6800)]),
    seededSale("sale-002", "SL-260830-0011", "2026-08-30T08:18:00.000Z", "cash", [line("prd-003", "Date Syrup 400ml", "DAT-400", 1, 1850), line("prd-001", "Arabic Coffee 250g", "COF-250", 1, 2850)]),
    seededSale("sale-003", "SL-260830-0012", "2026-08-30T08:42:00.000Z", "card", [line("prd-001", "Arabic Coffee 250g", "COF-250", 1, 2850), line("prd-005", "Premium Date Box", "DAT-PRM", 1, 6800)]),
  ],
  customers: initialCustomers,
  creditNotes: [],
  syncOperations: [],
  register: {
    id: "register-001",
    status: "open",
    openedAt: "2026-08-30T04:00:00.000Z",
    openingCashFils: 24000,
    adjustments: [],
  },
};

let state = initialState;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function save(next: DemoState) {
  state = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
    void persistOfflineSnapshot(next).catch(() => undefined);
  }
  emit();
}

function normalizeState(saved: Partial<DemoState>): DemoState {
  return {
    products: saved.products ?? initialState.products,
    stockMovements: saved.stockMovements ?? [],
    sales: saved.sales ?? initialState.sales,
    customers: saved.customers ?? initialCustomers,
    creditNotes: saved.creditNotes ?? [],
    syncOperations: saved.syncOperations ?? [],
    register: saved.register === undefined ? initialState.register : saved.register,
  };
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  const saved = window.localStorage.getItem(STORE_KEY);
  if (saved) {
    try { state = normalizeState(JSON.parse(saved) as Partial<DemoState>); } catch { state = initialState; }
  } else {
    const legacyProducts = window.localStorage.getItem(LEGACY_PRODUCT_KEY);
    if (legacyProducts) state = { ...initialState, products: JSON.parse(legacyProducts) as Product[] };
  }
  queueMicrotask(emit);
}

function enqueueOperation(next: DemoState, entity: SyncOperation["entity"], entityId: string, payload?: SyncOperation["payload"]) {
  return {
    ...next,
    syncOperations: [{ id: crypto.randomUUID(), entity, entityId, createdAt: new Date().toISOString(), status: "pending" as const, ...(payload ? { payload } : {}) }, ...next.syncOperations],
  };
}

function queueCustomerOperation(next: DemoState, entityId: string, payload: SyncOperation["payload"]) {
  if (typeof navigator !== "undefined" && navigator.onLine && !isSupabaseConfigured()) return next;
  return enqueueOperation(next, "customer", entityId, payload);
}
function queueSaleOperation(next: DemoState, sale: Sale) {
  if (typeof navigator !== "undefined" && navigator.onLine && !isSupabaseConfigured()) return next;
  return enqueueOperation(next, "sale", sale.id, { sale, register: state.register });
}

function queueRegisterOperation(next: DemoState, entityId: string, payload: SyncOperation["payload"]) {
  if (typeof navigator !== "undefined" && navigator.onLine && !isSupabaseConfigured()) return next;
  return enqueueOperation(next, "register", entityId, payload);
}

function queueCreditNoteOperation(next: DemoState, creditNote: CreditNote) {
  if (typeof navigator !== "undefined" && navigator.onLine && !isSupabaseConfigured()) return next;
  return enqueueOperation(next, "credit-note", creditNote.id, { creditNote });
}
function queueStockOperation(next: DemoState, movement: StockMovement, product: Product) {
  if (typeof navigator !== "undefined" && navigator.onLine && !isSupabaseConfigured()) return next;
  return enqueueOperation(next, "stock", movement.id, { movement, product });
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  hydrate();
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

function getServerSnapshot() {
  return initialState;
}

export function useDemoStore() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function createDemoStateBackup() {
  return structuredClone(state);
}

export function restoreDemoStateBackup(input: unknown): { ok: true } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "The backup does not contain a valid state object." };
  const candidate = input as Partial<DemoState>;
  if (!Array.isArray(candidate.products) || !Array.isArray(candidate.sales) || !Array.isArray(candidate.customers) || !Array.isArray(candidate.creditNotes)) {
    return { ok: false, error: "The backup is missing required shop collections." };
  }
  if (candidate.products.some((product) => !product || typeof product.id !== "string" || typeof product.stock !== "number" || product.stock < 0)) {
    return { ok: false, error: "The backup contains an invalid product or stock quantity." };
  }
  if (candidate.sales.some((sale) => !sale || typeof sale.id !== "string" || typeof sale.invoiceNumber !== "string" || sale.grossFils !== sale.netFils + sale.vatFils)) {
    return { ok: false, error: "The backup contains an invalid invoice total." };
  }
  save(normalizeState(candidate));
  return { ok: true };
}

export type CustomerInput = Omit<Customer, "id" | "createdAt" | "updatedAt">;

function validateCustomer(input: CustomerInput, existingId?: string) {
  if (!input.name.trim() || !input.phone.trim()) return "Customer name and phone are required.";
  if (input.trn && !/^\d{15}$/.test(input.trn)) return "TRN must contain exactly 15 digits.";
  const duplicateTrn = input.trn && state.customers.some((customer) => customer.id !== existingId && customer.trn === input.trn);
  if (duplicateTrn) return "That TRN is already assigned to another customer.";
  return null;
}

export function addCustomer(input: CustomerInput): { ok: true; customer: Customer } | { ok: false; error: string } {
  const error = validateCustomer(input);
  if (error) return { ok: false, error };
  const now = new Date().toISOString();
  const customer: Customer = { ...input, name: input.name.trim(), phone: input.phone.trim(), trn: input.trn?.trim() || undefined, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
  save(queueCustomerOperation({ ...state, customers: [customer, ...state.customers] }, customer.id, { customer }));
  return { ok: true, customer };
}

export function updateCustomer(id: string, input: CustomerInput): { ok: true } | { ok: false; error: string } {
  if (!state.customers.some((customer) => customer.id === id)) return { ok: false, error: "Customer not found." };
  const error = validateCustomer(input, id);
  if (error) return { ok: false, error };
  const next = {
    ...state,
    customers: state.customers.map((customer) => customer.id === id ? { ...customer, ...input, name: input.name.trim(), phone: input.phone.trim(), trn: input.trn?.trim() || undefined, updatedAt: new Date().toISOString() } : customer),
  };
  const updatedCustomer = next.customers.find((customer) => customer.id === id);
  save(queueCustomerOperation(next, id, updatedCustomer ? { customer: updatedCustomer } : undefined));
  return { ok: true };
}

export function addProduct(input: Omit<Product, "id" | "active">) {
  const product: Product = { ...input, id: crypto.randomUUID(), active: true };
  const movement: StockMovement | null = input.stock > 0 ? {
    id: crypto.randomUUID(), productId: product.id, delta: input.stock, type: "opening", reason: "Opening stock", createdAt: new Date().toISOString(),
  } : null;
  const next = { ...state, products: [product, ...state.products], stockMovements: movement ? [movement, ...state.stockMovements] : state.stockMovements };
  save(movement ? queueStockOperation(next, movement, product) : next);
}
export function adjustStock(productId: string, delta: number, reason: string) {
  const product = state.products.find((item) => item.id === productId);
  if (!product || product.stock + delta < 0) return false;
  const movement: StockMovement = {
    id: crypto.randomUUID(), productId, delta, type: delta > 0 ? "receipt" : "correction-out", reason, createdAt: new Date().toISOString(),
  };
  const next = {
    ...state,
    products: state.products.map((item) => item.id === productId ? { ...item, stock: item.stock + delta } : item),
    stockMovements: [movement, ...state.stockMovements],
  };
  const updatedProduct = next.products.find((item) => item.id === productId) ?? product;
  save(queueStockOperation(next, movement, updatedProduct));
  return true;
}
export function getRegisterTotals(source = state) {
  const register = source.register;
  if (!register) return { cashSalesFils: 0, cardSalesFils: 0, cashReturnsFils: 0, cardReturnsFils: 0, adjustmentsFils: 0, expectedCashFils: 0 };
  const sales = source.sales.filter((sale) => sale.createdAt >= register.openedAt && (!register.closedAt || sale.createdAt <= register.closedAt));
  const cashSalesFils = sales.filter((sale) => sale.paymentMethod === "cash").reduce((sum, sale) => sum + sale.grossFils, 0);
  const cardSalesFils = sales.filter((sale) => sale.paymentMethod === "card").reduce((sum, sale) => sum + sale.grossFils, 0);
  const creditNotes = source.creditNotes.filter((note) => note.createdAt >= register.openedAt && (!register.closedAt || note.createdAt <= register.closedAt));
  const cashReturnsFils = creditNotes.filter((note) => note.paymentMethod === "cash").reduce((sum, note) => sum + note.grossFils, 0);
  const cardReturnsFils = creditNotes.filter((note) => note.paymentMethod === "card").reduce((sum, note) => sum + note.grossFils, 0);
  const adjustmentsFils = register.adjustments.reduce((sum, adjustment) => sum + adjustment.amountFils, 0);
  return { cashSalesFils, cardSalesFils, cashReturnsFils, cardReturnsFils, adjustmentsFils, expectedCashFils: register.openingCashFils + cashSalesFils - cashReturnsFils + adjustmentsFils };
}

export function openRegister(openingCashFils: number) {
  if (state.register?.status === "open") return false;
  const register: NonNullable<DemoState["register"]> = { id: crypto.randomUUID(), status: "open", openedAt: new Date().toISOString(), openingCashFils, adjustments: [] };
  save(queueRegisterOperation({ ...state, register }, crypto.randomUUID(), { action: "open", register }));
  return true;
}
export function addCashAdjustment(amountFils: number, reason: string) {
  if (!state.register || state.register.status !== "open" || amountFils === 0) return false;
  const cashAdjustment = { id: crypto.randomUUID(), amountFils, reason, createdAt: new Date().toISOString() };
  const register = { ...state.register, adjustments: [cashAdjustment, ...state.register.adjustments] };
  save(queueRegisterOperation({ ...state, register }, cashAdjustment.id, { action: "adjustment", registerId: state.register.id, adjustment: cashAdjustment, register: state.register }));
  return true;
}
export function closeRegister(countedCashFils: number) {
  if (!state.register || state.register.status !== "open") return false;
  const { expectedCashFils } = getRegisterTotals();
  const register: NonNullable<DemoState["register"]> = { ...state.register, status: "closed", closedAt: new Date().toISOString(), countedCashFils, expectedCashFils, varianceFils: countedCashFils - expectedCashFils };
  save(queueRegisterOperation({ ...state, register }, crypto.randomUUID(), { action: "close", register }));
  return true;
}
export type CheckoutLine = { productId?: string; name: string; sku?: string; quantity: number; unitGrossFils: number };

function uaeDateCode(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", year: "2-digit", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}${value("month")}${value("day")}`;
}

function uaeSupplyDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function invoicePrefix() {
  if (typeof window === "undefined") return "SL";
  const value = window.localStorage.getItem(SETTINGS_KEY);
  if (!value) return "SL";
  try {
    const prefix = String((JSON.parse(value) as { prefix?: string }).prefix || "SL").toUpperCase();
    return /^[A-Z0-9-]{1,8}$/.test(prefix) ? prefix : "SL";
  } catch { return "SL"; }
}

export function completeSale(inputLines: CheckoutLine[], paymentMethod: PaymentMethod, customerId?: string): { ok: true; sale: Sale } | { ok: false; error: string } {
  if (!state.register || state.register.status !== "open") return { ok: false, error: "Open the register before completing a sale." };
  if (!inputLines.length) return { ok: false, error: "Add at least one item to the cart." };

  const requested = new Map<string, number>();
  for (const item of inputLines) {
    if (item.quantity < 1 || item.unitGrossFils < 1) return { ok: false, error: "Every line requires a valid quantity and price." };
    if (item.productId) requested.set(item.productId, (requested.get(item.productId) ?? 0) + item.quantity);
  }
  for (const [productId, quantity] of requested) {
    const product = state.products.find((item) => item.id === productId);
    if (!product || !product.active) return { ok: false, error: "A cart product is no longer available." };
    if (product.stock < quantity) return { ok: false, error: `${product.name} has only ${product.stock} available.` };
  }

  const now = new Date();
  const dateCode = uaeDateCode(now);
  const prefix = invoicePrefix().toUpperCase();
  const sameDayNumbers = state.sales
    .map((sale) => sale.invoiceNumber.match(new RegExp(`^${prefix}-${dateCode}-(\\d+)$`)))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => Number(match[1]));
  const sequence = Math.max(0, ...sameDayNumbers) + 1;
  const invoiceNumber = `${prefix}-${dateCode}-${String(sequence).padStart(4, "0")}`;
  const lines: InvoiceLine[] = inputLines.map((item) => {
    const totals = calculateVatInclusive(item.unitGrossFils * item.quantity);
    return { ...item, id: crypto.randomUUID(), ...totals };
  });
  const sale: Sale = {
    id: crypto.randomUUID(), invoiceNumber, createdAt: now.toISOString(), supplyDate: uaeSupplyDate(now), paymentMethod, lines,
    netFils: lines.reduce((sum, item) => sum + item.netFils, 0),
    vatFils: lines.reduce((sum, item) => sum + item.vatFils, 0),
    grossFils: lines.reduce((sum, item) => sum + item.grossFils, 0),
    customer: customerId ? (() => {
      const customer = state.customers.find((item) => item.id === customerId);
      if (!customer) return undefined;
      const { id, name, phone, email, address, trn } = customer;
      return { id, name, phone, email, address, trn };
    })() : undefined,
    status: "completed",
  };
  const movements: StockMovement[] = lines.filter((item) => item.productId).map((item) => ({
    id: crypto.randomUUID(), productId: item.productId!, delta: -item.quantity, type: "sale", reason: sale.invoiceNumber, createdAt: sale.createdAt,
  }));
  save(queueSaleOperation({
    ...state,
    products: state.products.map((product) => {
      const quantity = requested.get(product.id) ?? 0;
      return quantity ? { ...product, stock: product.stock - quantity } : product;
    }),
    sales: [sale, ...state.sales],
    stockMovements: [...movements, ...state.stockMovements],
  }, sale));
  return { ok: true, sale };
}

export function returnedQuantities(saleId: string) {
  const quantities = new Map<string, number>();
  for (const note of state.creditNotes.filter((item) => item.saleId === saleId)) {
    for (const item of note.lines) quantities.set(item.originalLineId, (quantities.get(item.originalLineId) ?? 0) + item.quantity);
  }
  return quantities;
}

export function createCreditNote(saleId: string, requestedQuantities: Record<string, number>): { ok: true; creditNote: CreditNote } | { ok: false; error: string } {
  if (!state.register || state.register.status !== "open") return { ok: false, error: "Open the register before processing a refund." };
  const sale = state.sales.find((item) => item.id === saleId);
  if (!sale) return { ok: false, error: "Original invoice not found." };
  const alreadyReturned = returnedQuantities(saleId);
  const validLines: { item: InvoiceLine; quantity: number }[] = [];
  for (const item of sale.lines) {
    const quantity = Math.floor(Number(requestedQuantities[item.id] ?? 0));
    if (quantity <= 0) continue;
    const available = item.quantity - (alreadyReturned.get(item.id) ?? 0);
    if (quantity > available) return { ok: false, error: `${item.name} has only ${available} available to return.` };
    validLines.push({ item, quantity });
  }
  if (!validLines.length) return { ok: false, error: "Choose at least one item to return." };

  const now = new Date();
  const dateCode = uaeDateCode(now);
  const sameDay = state.creditNotes.map((note) => note.creditNoteNumber.match(new RegExp(`^CN-${dateCode}-(\\d+)$`))).filter((match): match is RegExpMatchArray => Boolean(match)).map((match) => Number(match[1]));
  const creditNoteNumber = `CN-${dateCode}-${String(Math.max(0, ...sameDay) + 1).padStart(4, "0")}`;
  const lines = validLines.map(({ item, quantity }) => {
    const totals = calculateVatInclusive(item.unitGrossFils * quantity);
    return { ...item, id: crypto.randomUUID(), originalLineId: item.id, quantity, ...totals };
  });
  const creditNote: CreditNote = {
    id: crypto.randomUUID(), creditNoteNumber, saleId, invoiceNumber: sale.invoiceNumber, createdAt: now.toISOString(), paymentMethod: sale.paymentMethod, lines,
    netFils: lines.reduce((sum, item) => sum + item.netFils, 0), vatFils: lines.reduce((sum, item) => sum + item.vatFils, 0), grossFils: lines.reduce((sum, item) => sum + item.grossFils, 0),
  };
  const restored = new Map<string, number>();
  for (const item of lines) if (item.productId) restored.set(item.productId, (restored.get(item.productId) ?? 0) + item.quantity);
  const movements: StockMovement[] = lines.filter((item) => item.productId).map((item) => ({ id: crypto.randomUUID(), productId: item.productId!, delta: item.quantity, type: "return", reason: creditNote.creditNoteNumber, createdAt: creditNote.createdAt }));
  const next = {
    ...state,
    products: state.products.map((product) => restored.has(product.id) ? { ...product, stock: product.stock + restored.get(product.id)! } : product),
    creditNotes: [creditNote, ...state.creditNotes],
    stockMovements: [...movements, ...state.stockMovements],
  };
  save(queueCreditNoteOperation(next, creditNote));
  return { ok: true, creditNote };
}

export async function reconcilePendingOperations() {
  const pending = state.syncOperations.filter((operation) => operation.status === "pending" || operation.status === "failed");
  if (!pending.length) return { status: "idle" as const, pendingCount: 0, message: "There are no pending operations." };

  const syncable = pending.filter((operation) => (
    (operation.entity === "customer" && Boolean(operation.payload && "customer" in operation.payload)) ||
    (operation.entity === "sale" && Boolean(operation.payload && "sale" in operation.payload)) ||
    (operation.entity === "credit-note" && Boolean(operation.payload && "creditNote" in operation.payload)) ||
    (operation.entity === "register" && Boolean(operation.payload && "action" in operation.payload)) ||
    (operation.entity === "stock" && Boolean(operation.payload && "movement" in operation.payload))
  )).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  if (!syncable.length) {
    return { status: "blocked" as const, pendingCount: pending.length, message: "Hosted sync currently supports customer, sale, refund, register, and inventory changes only; other pending operations were kept safely." };
  }
  if (!isSupabaseConfigured()) {
    return { status: "blocked" as const, pendingCount: pending.length, message: "Supabase is not configured. Pending operations were kept safely." };
  }

  let response: Response;
  try {
    response = await fetch("/api/v1/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operations: syncable }),
    });
  } catch {
    return { status: "blocked" as const, pendingCount: pending.length, message: "The sync request could not reach the hosted service. Pending operations were kept safely." };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "blocked" as const, pendingCount: pending.length, message: "The hosted service returned an invalid sync response. Pending operations were kept safely." };
  }
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "The hosted service rejected the sync request.";
    return { status: "blocked" as const, pendingCount: pending.length, message: message + " Pending operations were kept safely." };
  }

  const rawResults = body && typeof body === "object" && "operations" in body && Array.isArray(body.operations)
    ? body.operations
    : [];
  const results = rawResults.filter((result): result is { id: string; status: "accepted" | "rejected"; error?: string } => (
    Boolean(result) &&
    typeof result === "object" &&
    "id" in result &&
    typeof result.id === "string" &&
    "status" in result &&
    (result.status === "accepted" || result.status === "rejected")
  ));
  const acceptedIds = new Set(results.filter((result) => result.status === "accepted").map((result) => result.id));
  const rejected = new Map(results.filter((result) => result.status === "rejected").map((result) => [result.id, result.error ?? "The hosted service rejected this operation."]));
  if (!acceptedIds.size && !rejected.size) {
    return { status: "blocked" as const, pendingCount: pending.length, message: "The hosted service did not acknowledge any operation. Pending operations were kept safely." };
  }

  const nextOperations = state.syncOperations.map((operation) => {
    if (acceptedIds.has(operation.id)) return { ...operation, status: "synced" as const, error: undefined };
    if (rejected.has(operation.id)) return { ...operation, status: "failed" as const, error: rejected.get(operation.id) };
    return operation;
  });
  save({ ...state, syncOperations: nextOperations });
  void clearSyncedOutbox(nextOperations).catch(() => undefined);

  const acceptedCount = acceptedIds.size;
  const rejectedCount = rejected.size;
  const status = rejectedCount ? acceptedCount ? "partial" as const : "failed" as const : "synced" as const;
  return {
    status,
    pendingCount: nextOperations.filter((operation) => operation.status === "pending").length,
    message: acceptedCount + " supported operation" + (acceptedCount === 1 ? "" : "s") + " synchronized" + (rejectedCount ? "; " + rejectedCount + " failed and remain visible for review." : "."),
  };
}
export function getSale(id: string) {
  return state.sales.find((sale) => sale.id === id);
}
