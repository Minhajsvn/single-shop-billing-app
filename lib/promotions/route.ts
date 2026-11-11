// SERVER ONLY. Stage 2E: refusals from the promotion functions as responses (never cached).
import { PROMOTION_CODES, promotionErrorMessage, promotionErrorStatus } from "./errors.ts";

export const NO_STORE = { "Cache-Control": "no-store" } as const;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function promotionRefusal(code: string): Response {
  return Response.json({ error: promotionErrorMessage(code), code }, { status: promotionErrorStatus(code), headers: NO_STORE });
}

export function promotionRpcFailure(action: string, error: { code?: string; message?: string }): Response {
  const code = error.code === "42501" ? "not_authorized" : error.code === "P0001" && error.message && PROMOTION_CODES.includes(error.message) ? error.message : "rpc_failed";
  if (code === "rpc_failed") console.error(`${action} failed`, error.code, error.message);
  return promotionRefusal(code);
}
