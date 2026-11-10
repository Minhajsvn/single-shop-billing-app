// SERVER ONLY. Stage 2C: shared plumbing for the cost and profit routes. The SQL functions decide who may see or set a
// cost (owner or manager, Pro); this only turns their refusals into responses.
import { profitErrorMessage, profitErrorStatus, PROFIT_CODES } from "./errors.ts";

export const NO_STORE = { "Cache-Control": "no-store" } as const;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function profitRefusal(code: string): Response {
  return Response.json({ error: profitErrorMessage(code), code }, { status: profitErrorStatus(code), headers: NO_STORE });
}

/** An rpc error as a response: 42501 is not_authorized, a P0001 message is our code, anything else is logged. */
export function profitRpcFailure(action: string, error: { code?: string; message?: string }): Response {
  const code = error.code === "42501" ? "not_authorized" : error.code === "P0001" && error.message && PROFIT_CODES.includes(error.message) ? error.message : "rpc_failed";
  if (code === "rpc_failed") console.error(`${action} failed`, error.code, error.message);
  return profitRefusal(code);
}
