// Stage 2D: browser calls for suppliers and deliveries. Online only; nothing here is cached or stored on the device.
import { purchasingErrorMessage } from "./errors.ts";
import type { LastDelivery, ReceiptDetail, ReceiptPayload, ReceiptSummary, Supplier } from "./types.ts";

type Deps = { fetch?: typeof fetch };
type Failure = { ok: false; error: string; offline?: boolean };

const OFFLINE = "Purchases need a connection";
const OFFLINE_RECORD = "Recording a delivery needs a connection";

async function call<T>(url: string, init: RequestInit | undefined, deps: Deps, offlineText = OFFLINE): Promise<{ ok: true; body: T } | Failure> {
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(url, { cache: "no-store", ...init });
  } catch {
    return { ok: false, offline: true, error: offlineText };
  }
  const body = (await response.json().catch(() => null)) as (T & { code?: string; detail?: string }) | null;
  if (!response.ok) return { ok: false, error: purchasingErrorMessage(body?.code ?? "", body?.detail) };
  return { ok: true, body: body as T };
}

const sendJson = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export async function listSuppliers(deps: Deps = {}): Promise<{ ok: true; suppliers: Supplier[] } | Failure> {
  const result = await call<{ suppliers: Supplier[] }>("/api/v1/suppliers", undefined, deps);
  return result.ok ? { ok: true, suppliers: result.body.suppliers } : result;
}

export async function saveSupplier(supplier: Supplier, deps: Deps = {}): Promise<{ ok: true } | Failure> {
  const result = await call<unknown>("/api/v1/suppliers", sendJson("PUT", supplier), deps);
  return result.ok ? { ok: true } : result;
}

export async function listReceipts(from: string, to: string, supplierId?: string, deps: Deps = {}): Promise<{ ok: true; receipts: ReceiptSummary[] } | Failure> {
  const query = new URLSearchParams({ from, to, ...(supplierId ? { supplier: supplierId } : {}) });
  const result = await call<{ receipts: ReceiptSummary[] }>(`/api/v1/purchases?${query}`, undefined, deps);
  return result.ok ? { ok: true, receipts: result.body.receipts } : result;
}

export async function getReceipt(id: string, deps: Deps = {}): Promise<{ ok: true; receipt: ReceiptDetail } | Failure> {
  const result = await call<ReceiptDetail>(`/api/v1/purchases/${encodeURIComponent(id)}`, undefined, deps);
  return result.ok ? { ok: true, receipt: result.body } : result;
}

/** Saving the same payload again (same id) is safe: the server returns the delivery it already has. */
export async function recordReceipt(payload: ReceiptPayload, deps: Deps = {}): Promise<{ ok: true; receipt: ReceiptDetail } | Failure> {
  const result = await call<ReceiptDetail>("/api/v1/purchases", sendJson("POST", payload), deps, OFFLINE_RECORD);
  return result.ok ? { ok: true, receipt: result.body } : result;
}

export async function voidReceipt(id: string, reason: string, deps: Deps = {}): Promise<{ ok: true } | Failure> {
  const result = await call<unknown>(`/api/v1/purchases/${encodeURIComponent(id)}/void`, sendJson("POST", { reason }), deps);
  return result.ok ? { ok: true } : result;
}

export async function lastDeliveries(deps: Deps = {}): Promise<{ ok: true; deliveries: Map<string, LastDelivery> } | Failure> {
  const result = await call<{ deliveries: (LastDelivery & { productId: string })[] }>("/api/v1/purchases/last-delivery", undefined, deps);
  if (!result.ok) return result;
  return { ok: true, deliveries: new Map(result.body.deliveries.map(({ productId, ...rest }) => [productId, rest])) };
}
