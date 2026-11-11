// Stage 2E: browser calls for managing promotions and reading results. Online only.
import { promotionErrorMessage } from "./errors.ts";
import type { Promotion } from "./types.ts";

type Deps = { fetch?: typeof fetch };
type Failure = { ok: false; error: string; offline?: boolean };
export type PromotionResult = { promotionId: string; name: string; uses: number; units: number; netFils: number; savingFils: number; costFils: number | null; profitFils: number | null };

const OFFLINE = "Promotions need a connection";

async function call<T>(url: string, init: RequestInit | undefined, deps: Deps): Promise<{ ok: true; body: T } | Failure> {
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(url, { cache: "no-store", ...init });
  } catch {
    return { ok: false, offline: true, error: OFFLINE };
  }
  const body = (await response.json().catch(() => null)) as (T & { code?: string }) | null;
  if (!response.ok) return { ok: false, error: promotionErrorMessage(body?.code ?? "") };
  return { ok: true, body: body as T };
}

export async function listPromotions(deps: Deps = {}): Promise<{ ok: true; promotions: Promotion[] } | Failure> {
  const result = await call<{ promotions: Promotion[] }>("/api/v1/promotions", undefined, deps);
  return result.ok ? { ok: true, promotions: result.body.promotions } : result;
}

export async function savePromotion(promotion: Promotion, deps: Deps = {}): Promise<{ ok: true } | Failure> {
  const result = await call<unknown>("/api/v1/promotions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(promotion) }, deps);
  return result.ok ? { ok: true } : result;
}

export async function promotionResults(from: string, to: string, deps: Deps = {}): Promise<{ ok: true; results: PromotionResult[] } | Failure> {
  const result = await call<{ results: PromotionResult[] }>(`/api/v1/promotions/results?from=${from}&to=${to}`, undefined, deps);
  return result.ok ? { ok: true, results: result.body.results } : result;
}
