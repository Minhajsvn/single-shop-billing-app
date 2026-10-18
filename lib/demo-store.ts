"use client";

import { SAMPLE_MODE_COOKIE } from "@/lib/auth/access-rules";
import { parseEntitlements, type Entitlements } from "@/lib/billing/entitlements";
import { clearStoredDeviceId, getStoredDeviceId } from "@/lib/device";
import {
  calculateVatInclusive,
  initialProducts,
  type CreditNote,
  type Customer,
  type DemoState,
  type InvoiceLine,
  type PaymentMethod,
  type Product,
  type ProductRecord,
  type Sale,
  type StockMovement,
  type SyncOperation,
} from "@/lib/domain";
import { saleBlockReason } from "@/lib/checkout/register-status";
import { dubaiSupplyDate, nextCreditNoteNumber, nextInvoiceNumber } from "@/lib/invoice-numbers";
import { clearOfflineCache, clearSyncedOutbox, loadOfflineCustomers, loadOfflineSnapshot, persistOfflineSnapshot } from "@/lib/offline-db";
import { mergeSnapshot } from "@/lib/snapshot/merge";
import { registerTotals } from "@/lib/store/register-totals";
import type { BusinessProfile, MemberRole, ShopSnapshot, TillDevice } from "@/lib/snapshot/types";
import {
  applySyncResults,
  chunk,
  type SyncResult,
  createSerialQueue,
  createSyncEpoch,
  effectiveEntitlements,
  emptyHostedContext,
  emptyShopState,
  hostedCacheKey,
  parseHostedCache,
  pickNewerCache,
  restoreFromIndexed,
  type HostedCache,
  type HostedContext,
} from "@/lib/store/hosted";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import type { ImportPlan } from "@/lib/catalogue/classify";
import { heldStockOperations, stampSequence, supersedeProductOperations, syncOrder, withTaxCategories } from "@/lib/store/product-sync";
import { useSyncExternalStore } from "react";

// Sample and unconfigured (no Supabase) modes keep using the original browser-only demo keys.
const STORE_KEY = "shop-ledger-demo-store-v2";
const LEGACY_PRODUCT_KEY = "shop-ledger-demo-products-v1";
const SETTINGS_KEY = "shop-ledger-demo-settings-v1";
// Hosted mode never touches the demo keys above; it caches each user's last server snapshot under
// hostedCacheKey(userId) (customers excluded). This unscoped key from earlier builds is removed on start.
const LEGACY_HOSTED_KEY = "shop-ledger-hosted-store-v1";
const SAMPLE_COOKIE = SAMPLE_MODE_COOKIE;

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
    // Opened "now" so a fresh sample shop can sell straight away (a register from an earlier day blocks checkout).
    openedAt: new Date().toISOString(),
    openingCashFils: 24000,
    adjustments: [],
  },
};

export type StoreMode = "hosted" | "sample" | "unconfigured";

export type ShopContext = {
  mode: StoreMode;
  business: BusinessProfile | null;
  device: TillDevice | null;
  devices: TillDevice[];
  entitlements: Entitlements;
  /** True when the cached entitlements have passed their signed expiry (offline too long) or there is no cache. */
  entitlementsStale: boolean;
  role: MemberRole | null;
  lastRefreshedAt: string | null;
};

function sampleRequested() {
  try {
    return typeof document !== "undefined" && document.cookie.split("; ").includes(`${SAMPLE_COOKIE}=sample`);
  } catch {
    return false;
  }
}

function initialMode(): StoreMode {
  if (!isSupabaseConfigured()) return "unconfigured";
  return sampleRequested() ? "sample" : "hosted";
}

let mode: StoreMode = initialMode();
let state: DemoState = mode === "hosted" ? emptyShopState() : initialState;
let hostedContext: HostedContext = emptyHostedContext();
let hydrated = false;
// The signed-in user whose hosted shop is loaded; every hosted cache is keyed by it (ruling R17).
let activeUserId: string | null = null;
const listeners = new Set<() => void>();
const contextListeners = new Set<() => void>();
// Sync and snapshot refresh never overlap (ruling R8): a snapshot read while a sync commits could
// count a sale's stock twice or drop the sale, because products and sales are read separately.
const runSerial = createSerialQueue();
const syncEpoch = createSyncEpoch();

function buildContext(): ShopContext {
  const deviceId = getStoredDeviceId();
  const { entitlements, stale } = effectiveEntitlements(hostedContext.entitlementCache);
  return {
    mode,
    business: hostedContext.business,
    devices: hostedContext.devices,
    device: hostedContext.devices.find((device) => device.id === deviceId && (device.status === "active" || device.status === "paused")) ?? null,
    entitlements,
    entitlementsStale: stale,
    role: mode === "hosted" ? hostedContext.role ?? null : "owner",
    lastRefreshedAt: hostedContext.lastRefreshedAt,
  };
}

let contextSnapshot: ShopContext = buildContext();
const serverContext: ShopContext = buildContext();
const serverState: DemoState = mode === "hosted" ? state : initialState;

function emit() {
  listeners.forEach((listener) => listener());
}

function emitContext() {
  contextSnapshot = buildContext();
  contextListeners.forEach((listener) => listener());
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    if (mode === "hosted") {
      // Nothing is cached until we know whose shop this is (ruling R17).
      if (!activeUserId) return;
      const savedAt = Date.now();
      // IndexedDB first: if localStorage is full (a large import) the outbox still survives a closed tab.
      // Customers are cached only in IndexedDB, encrypted with this device's key (ruling R10).
      void persistOfflineSnapshot(state, activeUserId, savedAt).catch(() => undefined);
      const cache: HostedCache = { version: 1, savedAt, state: { ...state, customers: [] }, context: hostedContext };
      window.localStorage.setItem(hostedCacheKey(activeUserId), JSON.stringify(cache));
    } else {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
    }
  } catch {
    // Storage full or blocked: the in-memory state keeps working for this session.
  }
}

function save(next: DemoState) {
  state = next;
  persist();
  emit();
}

function normalizeState(saved: Partial<DemoState>): DemoState {
  return {
    products: withTaxCategories(saved.products ?? initialState.products),
    stockMovements: saved.stockMovements ?? [],
    sales: saved.sales ?? initialState.sales,
    customers: saved.customers ?? initialCustomers,
    creditNotes: saved.creditNotes ?? [],
    syncOperations: saved.syncOperations ?? [],
    register: saved.register === undefined ? initialState.register : saved.register,
  };
}

function readStorage(key: string) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  if (mode === "hosted") {
    // The hosted cache is loaded by startHostedStore once the signed-in user is known.
  } else {
    const saved = readStorage(STORE_KEY);
    if (saved) {
      try { state = normalizeState(JSON.parse(saved) as Partial<DemoState>); } catch { state = initialState; }
    } else {
      const legacyProducts = readStorage(LEGACY_PRODUCT_KEY);
      if (legacyProducts) {
        try { state = { ...initialState, products: withTaxCategories(JSON.parse(legacyProducts) as Product[]) }; } catch { state = initialState; }
      }
    }
  }
  queueMicrotask(() => {
    emit();
    emitContext();
  });
}

function enqueueOperation(next: DemoState, entity: SyncOperation["entity"], entityId: string, payload?: SyncOperation["payload"]) {
  // Only hosted shops sync; sample and unconfigured stores stay in this browser.
  if (mode !== "hosted") return next;
  const deviceId = contextSnapshot.device?.id;
  const tagged = payload ? { ...payload, ...(deviceId ? { deviceId } : {}) } : undefined;
  return {
    ...next,
    syncOperations: [{ id: crypto.randomUUID(), entity, entityId, createdAt: new Date().toISOString(), status: "pending" as const, ...(tagged ? { payload: tagged } : {}) }, ...next.syncOperations],
  };
}

function queueCustomerOperation(next: DemoState, entityId: string, payload: SyncOperation["payload"]) {
  return enqueueOperation(next, "customer", entityId, payload);
}
function queueSaleOperation(next: DemoState, sale: Sale) {
  return enqueueOperation(next, "sale", sale.id, { sale, register: state.register });
}

function queueRegisterOperation(next: DemoState, entityId: string, payload: SyncOperation["payload"]) {
  return enqueueOperation(next, "register", entityId, payload);
}

function queueCreditNoteOperation(next: DemoState, creditNote: CreditNote) {
  return enqueueOperation(next, "credit-note", creditNote.id, { creditNote });
}
function queueStockOperation(next: DemoState, movement: StockMovement, product: Product) {
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
  return serverState;
}

export function useDemoStore() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribeContext(listener: () => void) {
  contextListeners.add(listener);
  hydrate();
  return () => contextListeners.delete(listener);
}

export function useShopContext(): ShopContext {
  return useSyncExternalStore(subscribeContext, () => contextSnapshot, () => serverContext);
}

export function getStoreMode(): StoreMode {
  return mode;
}

function applySnapshot(snapshot: ShopSnapshot) {
  // A cache from another business (a different account on this browser) is never merged into this one.
  const sameBusiness = !hostedContext.business || hostedContext.business.id === snapshot.business.id;
  const merged = mergeSnapshot(snapshot.state, sameBusiness ? state : emptyShopState());
  hostedContext = {
    business: snapshot.business,
    devices: snapshot.devices,
    role: snapshot.role ?? null,
    entitlementCache: sameBusiness ? hostedContext.entitlementCache : null,
    lastRefreshedAt: snapshot.generatedAt,
  };
  save(merged);
  emitContext();
}

async function fetchSnapshot(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (mode !== "hosted") return { ok: false, error: "This browser is not connected to a hosted shop." };
  const startedAt = syncEpoch.current();
  const deviceId = getStoredDeviceId();
  let response: Response;
  try {
    response = await fetch(`/api/v1/snapshot${deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : ""}`, { cache: "no-store" });
  } catch {
    return { ok: false, error: "The shop data could not be reached. Showing the last saved copy." };
  }
  const body = await response.json().catch(() => null) as (ShopSnapshot & { error?: string }) | null;
  if (!response.ok || !body?.business) {
    return { ok: false, error: body?.error ?? "The shop data could not be loaded." };
  }
  // A sync finished after this request started, so this snapshot may predate it; a newer refresh follows.
  if (syncEpoch.isStale(startedAt)) return { ok: true };
  applySnapshot(body);
  return { ok: true };
}

export function refreshSnapshot(): Promise<{ ok: true } | { ok: false; error: string }> {
  return runSerial(fetchSnapshot);
}

async function refreshEntitlements() {
  try {
    const response = await fetch("/api/v1/entitlements", { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json() as { businessId?: string; entitlements?: unknown; expiresAt?: string };
    if (hostedContext.business && body.businessId !== hostedContext.business.id) return;
    hostedContext = { ...hostedContext, entitlementCache: { entitlements: parseEntitlements(body.entitlements), expiresAt: String(body.expiresAt) } };
    persist();
    emitContext();
  } catch {
    // Offline or misconfigured: keep the cached entitlements until they expire.
  }
}

function clearSampleCookie() {
  try { document.cookie = `${SAMPLE_COOKIE}=; path=/; Max-Age=0; SameSite=Lax`; } catch { /* ignore */ }
}

/** Loads this user's cached shop; the returned promise settles once the IndexedDB copy has been checked. */
async function loadUserCache(userId: string): Promise<void> {
  const cache = parseHostedCache(readStorage(hostedCacheKey(userId)));
  state = cache?.state ?? emptyShopState();
  hostedContext = cache?.context ?? emptyHostedContext();
  emit();
  emitContext();
  // Remove the unscoped cache written by earlier builds; it could belong to another account.
  try { window.localStorage.removeItem(LEGACY_HOSTED_KEY); } catch { /* ignore */ }
  void clearOfflineCache(null).catch(() => undefined);
  // localStorage may be stale or missing (quota full after a large import); IndexedDB may hold a newer copy.
  // Anything done meanwhile is kept: the outbox is merged by operation id, never replaced.
  try {
    const indexed = await loadOfflineSnapshot(userId);
    if (indexed && mode === "hosted" && activeUserId === userId && pickNewerCache(cache, indexed) === "indexed") {
      save(restoreFromIndexed(state, indexed.state));
    }
  } catch { /* IndexedDB unavailable: the localStorage copy stands */ }
  try {
    const customers = await loadOfflineCustomers(userId);
    if (customers && mode === "hosted" && activeUserId === userId && !state.customers.length) {
      state = { ...state, customers };
      emit();
    }
  } catch { /* customers stay as loaded */ }
}

/** Switches this browser to the signed-in user's hosted shop. Called with the session's user id (also leaves sample mode). */
export async function startHostedStore(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  clearSampleCookie();
  try { window.sessionStorage.removeItem("shop-ledger-mode"); } catch { /* ignore */ }
  if (mode !== "hosted" || activeUserId !== userId) {
    mode = "hosted";
    hydrated = true;
    activeUserId = userId;
    // Wait for the IndexedDB check so the snapshot refresh merges against the complete outbox.
    await loadUserCache(userId);
  }
  const [snapshot] = await Promise.all([refreshSnapshot(), refreshEntitlements()]);
  // With a cached copy the shop keeps working offline; without one there is nothing safe to show.
  if (!snapshot.ok && !hostedContext.business) return snapshot;
  return { ok: true };
}

/** Forgets this browser's till so the till picker asks again. Unsynced work keeps its own till and syncs under it. */
export function switchThisTill() {
  if (mode !== "hosted") return;
  clearStoredDeviceId();
  emitContext();
}

export function startSampleStore() {
  try { document.cookie = `${SAMPLE_COOKIE}=sample; path=/; SameSite=Lax`; } catch { /* ignore */ }
  try { window.sessionStorage.setItem("shop-ledger-mode", "sample"); } catch { /* ignore */ }
  mode = "sample";
  hydrated = false;
  activeUserId = null;
  state = initialState;
  hostedContext = emptyHostedContext();
  hydrate();
  emit();
  emitContext();
}

/**
 * Sign-out. Only the hosted shop of the signed-in user is ever touched (never from sample mode). Unsynced work
 * stays in that user's own cache and syncs when they sign in again; otherwise the cache is wiped from this browser.
 */
export function clearHostedStore(): { cleared: boolean; pending: number } {
  if (mode !== "hosted" || !activeUserId) return { cleared: false, pending: 0 };
  const pending = state.syncOperations.filter((operation) => operation.status !== "synced").length;
  if (!pending) {
    try { window.localStorage.removeItem(hostedCacheKey(activeUserId)); } catch { /* ignore */ }
    void clearOfflineCache(activeUserId).catch(() => undefined);
  }
  activeUserId = null;
  state = emptyShopState();
  hostedContext = emptyHostedContext();
  emit();
  emitContext();
  return { cleared: !pending, pending };
}

export function createDemoStateBackup() {
  return structuredClone(state);
}

export function restoreDemoStateBackup(input: unknown): { ok: true } | { ok: false; error: string } {
  if (mode === "hosted") return { ok: false, error: "Restoring a backup is only available in the sample shop. Your hosted data is stored safely on the server." };
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

type QueuedItem = { entity: SyncOperation["entity"]; entityId: string; payload: SyncOperation["payload"] };

/** Queues several operations so they sync in exactly this order (a product before its opening stock). */
function enqueueInOrder(next: DemoState, items: QueuedItem[]): DemoState {
  if (mode !== "hosted" || !items.length) return next;
  const deviceId = contextSnapshot.device?.id;
  const ops: SyncOperation[] = stampSequence(items.map((item) => ({
    id: crypto.randomUUID(),
    entity: item.entity,
    entityId: item.entityId,
    createdAt: "",
    status: "pending" as const,
    ...(item.payload ? { payload: { ...item.payload, ...(deviceId ? { deviceId } : {}) } } : {}),
  })), new Date());
  // The outbox is kept newest first.
  return { ...next, syncOperations: [...ops.reverse(), ...next.syncOperations] };
}

function productRecord(product: Product): ProductRecord {
  return { id: product.id, name: product.name, sku: product.sku, barcode: product.barcode, priceFils: product.priceFils, lowStockThreshold: product.lowStockThreshold, active: product.active, taxCategory: product.taxCategory };
}

function productItem(product: Product): QueuedItem {
  return { entity: "product", entityId: product.id, payload: { product: productRecord(product) } };
}

/** The plan's product limit for this shop; sample and unconfigured stores have none. */
export function productLimit(): number | null {
  return mode === "hosted" ? contextSnapshot.entitlements.limits.products ?? null : null;
}

function overLimitError(limit: number) {
  return `Over your plan's limit of ${limit} products: upgrade to Pro`;
}

function duplicateOf(id: string | null, sku: string, barcode: string | undefined) {
  const skuKey = sku.trim().toLowerCase();
  return state.products.some((product) => product.id !== id && (product.sku.trim().toLowerCase() === skuKey || (barcode && product.barcode === barcode)));
}

export function addProduct(input: Omit<Product, "id" | "active">): { ok: true; product: Product } | { ok: false; error: string } {
  if (duplicateOf(null, input.sku, input.barcode)) return { ok: false, error: "SKU and barcode must be unique." };
  const limit = productLimit();
  if (limit !== null && state.products.filter((product) => product.active).length >= limit) return { ok: false, error: overLimitError(limit) };
  const product: Product = { ...input, id: crypto.randomUUID(), active: true };
  const movement: StockMovement | null = input.stock > 0 ? {
    id: crypto.randomUUID(), productId: product.id, delta: input.stock, type: "opening", reason: "Opening stock", createdAt: new Date().toISOString(),
  } : null;
  const next = { ...state, products: [product, ...state.products], stockMovements: movement ? [movement, ...state.stockMovements] : state.stockMovements };
  // The product travels as its own operation, so a product with no opening stock still reaches the server.
  save(enqueueInOrder(next, [productItem(product), ...(movement ? [{ entity: "stock" as const, entityId: movement.id, payload: { movement } }] : [])]));
  return { ok: true, product };
}

export type ProductPatch = Partial<Pick<Product, "name" | "sku" | "barcode" | "priceFils" | "lowStockThreshold" | "taxCategory">>;

export function updateProduct(id: string, patch: ProductPatch): { ok: true } | { ok: false; error: string } {
  const current = state.products.find((product) => product.id === id);
  if (!current) return { ok: false, error: "This product no longer exists." };
  const updated: Product = { ...current, ...patch };
  if (!updated.name.trim() || !updated.sku.trim()) return { ok: false, error: "Name and SKU are required." };
  if (!Number.isInteger(updated.priceFils) || updated.priceFils < 1) return { ok: false, error: "Enter a price above 0." };
  if (duplicateOf(id, updated.sku, updated.barcode)) return { ok: false, error: "SKU and barcode must be unique." };
  const next = { ...state, products: state.products.map((product) => product.id === id ? updated : product), syncOperations: supersedeProductOperations(state.syncOperations, id) };
  save(enqueueInOrder(next, [productItem(updated)]));
  return { ok: true };
}

/** Archive (hidden from the till, kept for past invoices) or restore a product. */
export function setProductActive(id: string, active: boolean): { ok: true } | { ok: false; error: string } {
  const current = state.products.find((product) => product.id === id);
  if (!current) return { ok: false, error: "This product no longer exists." };
  if (current.active === active) return { ok: true };
  const limit = productLimit();
  if (active && limit !== null && state.products.filter((product) => product.active).length >= limit) return { ok: false, error: overLimitError(limit) };
  const updated = { ...current, active };
  const next = { ...state, products: state.products.map((product) => product.id === id ? updated : product), syncOperations: supersedeProductOperations(state.syncOperations, id) };
  save(enqueueInOrder(next, [productItem(updated)]));
  return { ok: true };
}

const IMPORT_REASON = "Spreadsheet import";

/** Applies a confirmed import in one save: product operations first, then opening stock and stock counts. */
export function applyImport(plan: ImportPlan): { createdIds: string[]; updatedIds: string[]; operationIds: string[] } {
  const now = new Date().toISOString();
  const items: QueuedItem[] = [];
  const movements: StockMovement[] = [];
  let products = state.products;
  let syncOperations = state.syncOperations;
  const createdIds: string[] = [];
  const updatedIds: string[] = [];

  for (const create of plan.creates) {
    const product: Product = { ...create.product, active: true };
    products = [product, ...products];
    createdIds.push(product.id);
    items.push(productItem(product));
    if (product.stock > 0) {
      const movement: StockMovement = { id: crypto.randomUUID(), productId: product.id, delta: product.stock, type: "opening", reason: IMPORT_REASON, createdAt: now };
      movements.push(movement);
      items.push({ entity: "stock", entityId: movement.id, payload: { movement } });
    }
  }

  for (const update of plan.updates) {
    if (!update.changed) continue;
    const current = products.find((product) => product.id === update.productId);
    if (!current) continue;
    const updated: Product = { ...current, priceFils: update.after.priceFils, barcode: update.after.barcode, stock: update.after.stock };
    products = products.map((product) => product.id === current.id ? updated : product);
    updatedIds.push(current.id);
    if (current.priceFils !== updated.priceFils || current.barcode !== updated.barcode) {
      syncOperations = supersedeProductOperations(syncOperations, current.id);
      items.push(productItem(updated));
    }
    const delta = updated.stock - current.stock;
    if (delta !== 0) {
      // A count, not a delivery: the server sets stock to countedStock and records its own difference.
      const movement: StockMovement = { id: crypto.randomUUID(), productId: current.id, delta, type: "import-count", reason: IMPORT_REASON, createdAt: now };
      movements.push(movement);
      items.push({ entity: "stock", entityId: movement.id, payload: { movement, countedStock: updated.stock } });
    }
  }

  const next = enqueueInOrder({ ...state, products, syncOperations, stockMovements: [...movements.reverse(), ...state.stockMovements] }, items);
  // enqueueInOrder prepends this import's operations (none outside hosted mode).
  const operationIds = next.syncOperations.length > syncOperations.length ? next.syncOperations.slice(0, items.length).map((operation) => operation.id) : [];
  save(next);
  return { createdIds, updatedIds, operationIds };
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
  // Hosted shops share one sales list across tills; only this till's documents belong in its drawer.
  return registerTotals(source, mode === "hosted" ? contextSnapshot.device?.id ?? null : null);
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
export type CheckoutLine = { productId?: string; name: string; sku?: string; quantity: number; unitGrossFils: number; listUnitGrossFils?: number };

function invoicePrefix() {
  if (mode === "hosted") return contextSnapshot.business?.invoicePrefix ?? "SL";
  if (typeof window === "undefined") return "SL";
  const value = readStorage(SETTINGS_KEY);
  if (!value) return "SL";
  try {
    const prefix = String((JSON.parse(value) as { prefix?: string }).prefix || "SL").toUpperCase();
    return /^[A-Z0-9-]{1,8}$/.test(prefix) ? prefix : "SL";
  } catch { return "SL"; }
}

/** Hosted shops number documents per till; the browser-only stores behave as a single till 1. */
function tillNumber() {
  return mode === "hosted" ? contextSnapshot.device?.tillNumber ?? null : 1;
}

export function completeSale(inputLines: CheckoutLine[], paymentMethod: PaymentMethod, customerId?: string): { ok: true; sale: Sale } | { ok: false; error: string } {
  const till = tillNumber();
  if (till === null) return { ok: false, error: "Choose which till this browser is before selling." };
  // Re-checked here, not only at render: a sale started before Dubai midnight must not land on yesterday's register.
  const blocked = saleBlockReason(state.register, new Date());
  if (blocked || !state.register) return { ok: false, error: blocked ?? "Open the register before completing a sale." };
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
  const invoiceNumber = nextInvoiceNumber(invoicePrefix().toUpperCase(), till, now, state.sales.map((sale) => sale.invoiceNumber));
  const lines: InvoiceLine[] = inputLines.map((item) => {
    const totals = calculateVatInclusive(item.unitGrossFils * item.quantity);
    return { ...item, id: crypto.randomUUID(), ...totals };
  });
  const business = mode === "hosted" ? contextSnapshot.business : null;
  const sale: Sale = {
    id: crypto.randomUUID(), invoiceNumber, createdAt: now.toISOString(), supplyDate: dubaiSupplyDate(now), paymentMethod, lines,
    netFils: lines.reduce((sum, item) => sum + item.netFils, 0),
    vatFils: lines.reduce((sum, item) => sum + item.vatFils, 0),
    grossFils: lines.reduce((sum, item) => sum + item.grossFils, 0),
    customer: customerId ? (() => {
      const customer = state.customers.find((item) => item.id === customerId);
      if (!customer) return undefined;
      const { id, name, phone, email, address, trn } = customer;
      return { id, name, phone, email, address, trn };
    })() : undefined,
    supplier: business ? { name: business.legalName, trn: business.trn, address: business.address, phone: business.phone } : undefined,
    deviceId: mode === "hosted" ? contextSnapshot.device?.id : undefined,
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
  const till = tillNumber();
  if (till === null) return { ok: false, error: "Choose which till this browser is before processing a refund." };
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
  const creditNoteNumber = nextCreditNoteNumber(till, now, state.creditNotes.map((note) => note.creditNoteNumber));
  const lines = validLines.map(({ item, quantity }) => {
    const totals = calculateVatInclusive(item.unitGrossFils * quantity);
    return { ...item, id: crypto.randomUUID(), originalLineId: item.id, quantity, ...totals };
  });
  const creditNote: CreditNote = {
    id: crypto.randomUUID(), creditNoteNumber, saleId, invoiceNumber: sale.invoiceNumber, createdAt: now.toISOString(), paymentMethod: sale.paymentMethod, lines,
    netFils: lines.reduce((sum, item) => sum + item.netFils, 0), vatFils: lines.reduce((sum, item) => sum + item.vatFils, 0), grossFils: lines.reduce((sum, item) => sum + item.grossFils, 0),
    deviceId: mode === "hosted" ? contextSnapshot.device?.id : undefined,
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

type ReconcileResult = { status: "idle" | "blocked" | "synced" | "partial" | "failed"; pendingCount: number; message: string };

// Whether a sync run is in flight, for the "Syncing · N left" status line.
let syncing = false;
const syncingListeners = new Set<() => void>();
function setSyncing(next: boolean) {
  if (syncing === next) return;
  syncing = next;
  syncingListeners.forEach((listener) => listener());
}
export function isSyncing() {
  return syncing;
}
export function subscribeSyncing(listener: () => void) {
  syncingListeners.add(listener);
  return () => { syncingListeners.delete(listener); };
}

export async function reconcilePendingOperations(): Promise<ReconcileResult> {
  setSyncing(true);
  try {
    const result = await runSerial(syncPendingOperations);
    // Refresh only after the sync has finished, through the same serial queue (ruling R8).
    if (result.status === "synced" || result.status === "partial") void refreshSnapshot();
    return result;
  } finally {
    setSyncing(false);
  }
}

const SYNC_BATCH_SIZE = 50;

async function postSyncBatch(batch: SyncOperation[]): Promise<{ ok: true; results: SyncResult[] } | { ok: false; message: string }> {
  let response: Response;
  try {
    response = await fetch("/api/v1/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operations: batch }),
    });
  } catch {
    return { ok: false, message: "The sync request could not reach the hosted service. Pending operations were kept safely." };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, message: "The hosted service returned an invalid sync response. Pending operations were kept safely." };
  }
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "The hosted service rejected the sync request.";
    return { ok: false, message: message + " Pending operations were kept safely." };
  }
  const rawResults = body && typeof body === "object" && "operations" in body && Array.isArray(body.operations) ? body.operations : [];
  return {
    ok: true,
    results: rawResults.filter((result): result is SyncResult => (
      Boolean(result) && typeof result === "object" && "id" in result && typeof result.id === "string" &&
      "status" in result && (result.status === "accepted" || result.status === "rejected")
    )),
  };
}

async function syncPendingOperations(): Promise<ReconcileResult> {
  const pending = state.syncOperations.filter((operation) => operation.status === "pending" || operation.status === "failed");
  if (!pending.length) return { status: "idle", pendingCount: 0, message: "There are no pending operations." };

  // Stock, sales and refunds of a product the server refused wait until the product is fixed and accepted.
  const held = heldStockOperations(state.syncOperations);
  const syncable = syncOrder(pending.filter((operation) => (
    (operation.entity === "customer" && Boolean(operation.payload && "customer" in operation.payload)) ||
    (operation.entity === "sale" && Boolean(operation.payload && "sale" in operation.payload)) ||
    (operation.entity === "credit-note" && Boolean(operation.payload && "creditNote" in operation.payload)) ||
    (operation.entity === "register" && Boolean(operation.payload && "action" in operation.payload)) ||
    (operation.entity === "stock" && Boolean(operation.payload && "movement" in operation.payload)) ||
    (operation.entity === "product" && Boolean(operation.payload && "product" in operation.payload && !("movement" in operation.payload)))
  ) && !held.has(operation.id)));
  if (!syncable.length) {
    return { status: "blocked", pendingCount: pending.length, message: "Hosted sync currently supports customer, sale, refund, register, and inventory changes only; other pending operations were kept safely." };
  }
  if (mode !== "hosted") {
    return { status: "blocked", pendingCount: pending.length, message: "This browser is not connected to a hosted shop. Pending operations were kept safely." };
  }

  // The sync API accepts at most 50 operations per request; send oldest-first batches, stopping at the
  // first failure. Each batch's results are saved as they arrive, so a large import shows real progress
  // and a closed tab re-sends only what the server has not acknowledged (operations are idempotent).
  let acceptedCount = 0;
  let rejectedCount = 0;
  let blockedMessage: string | null = null;
  for (const batch of chunk(syncable, SYNC_BATCH_SIZE)) {
    const outcome = await postSyncBatch(batch);
    if (!outcome.ok) {
      blockedMessage = outcome.message;
      break;
    }
    if (!outcome.results.length) continue;
    acceptedCount += outcome.results.filter((result) => result.status === "accepted").length;
    rejectedCount += outcome.results.filter((result) => result.status === "rejected").length;
    syncEpoch.bump();
    const nextOperations = applySyncResults(state.syncOperations, outcome.results);
    save({ ...state, syncOperations: nextOperations });
    void clearSyncedOutbox(nextOperations).catch(() => undefined);
  }
  if (!acceptedCount && !rejectedCount) {
    return { status: "blocked", pendingCount: pending.length, message: blockedMessage ?? "The hosted service did not acknowledge any operation. Pending operations were kept safely." };
  }
  const nextOperations = state.syncOperations;
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
