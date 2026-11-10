// Stage 2C: browser calls for cost and profit. Online only; nothing here is cached or written to IndexedDB.
import { profitErrorMessage } from "./errors.ts";
import type { ProfitReport } from "./types.ts";

type Deps = { fetch?: typeof fetch; reconcile?: () => Promise<unknown> };

const OFFLINE_COST = "Cost needs a connection";
const OFFLINE_PROFIT = "Profit needs a connection";

async function refusal(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { code?: string } | null;
  return profitErrorMessage(body?.code ?? "");
}

/** Every costed product of the shop (owner or manager on Pro). */
export async function fetchProductCosts(deps: Deps = {}): Promise<{ ok: true; costs: Map<string, number> } | { ok: false; error: string }> {
  const request = deps.fetch ?? fetch;
  let response: Response;
  try {
    response = await request("/api/v1/products/costs", { cache: "no-store" });
  } catch {
    return { ok: false, error: OFFLINE_COST };
  }
  if (!response.ok) return { ok: false, error: await refusal(response) };
  const body = (await response.json()) as { costs: { productId: string; costFils: number }[] };
  return { ok: true, costs: new Map(body.costs.map((row) => [row.productId, Number(row.costFils)])) };
}

/**
 * Sets or clears one product's cost. Pending work is synced first, so a product made on this till a moment ago has
 * reached the server; if it still has not, the refusal says the cost will save once it has.
 */
export async function saveProductCost(productId: string, costFils: number | null, deps: Deps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const request = deps.fetch ?? fetch;
  try {
    await deps.reconcile?.();
  } catch {
    // Sync trouble is reported by the outbox; the cost call below says whether the product is there.
  }
  let response: Response;
  try {
    response = await request(`/api/v1/products/${encodeURIComponent(productId)}/cost`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ costFils }),
    });
  } catch {
    return { ok: false, error: OFFLINE_COST };
  }
  return response.ok ? { ok: true } : { ok: false, error: await refusal(response) };
}

export async function fetchProfitReport(from: string, to: string, deps: Deps = {}): Promise<{ ok: true; report: ProfitReport } | { ok: false; error: string; offline?: boolean }> {
  const request = deps.fetch ?? fetch;
  let response: Response;
  try {
    response = await request(`/api/v1/reports/profit?from=${from}&to=${to}`, { cache: "no-store" });
  } catch {
    return { ok: false, offline: true, error: OFFLINE_PROFIT };
  }
  if (!response.ok) return { ok: false, error: await refusal(response) };
  return { ok: true, report: (await response.json()) as ProfitReport };
}
