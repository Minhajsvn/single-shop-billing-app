// SERVER ONLY. Stage 2D: shared plumbing for the purchasing routes. The SQL functions decide who may (owner or
// manager on Pro); this only turns their refusals into responses.
import { PURCHASING_CODES, purchasingErrorMessage, purchasingErrorStatus } from "./errors.ts";

export const NO_STORE = { "Cache-Control": "no-store" } as const;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function purchasingRefusal(code: string, detail?: string): Response {
  return Response.json({ error: purchasingErrorMessage(code, detail), code, ...(detail ? { detail } : {}) }, { status: purchasingErrorStatus(code), headers: NO_STORE });
}

/** An rpc error as a response: 42501 is not_authorized, a P0001 message is our code (with its detail), else logged. */
export function purchasingRpcFailure(action: string, error: { code?: string; message?: string; details?: string | null }): Response {
  const code = error.code === "42501" ? "not_authorized" : error.code === "P0001" && error.message && PURCHASING_CODES.includes(error.message) ? error.message : "rpc_failed";
  if (code === "rpc_failed") console.error(`${action} failed`, error.code, error.message);
  return purchasingRefusal(code, code === "rpc_failed" ? undefined : error.details ?? undefined);
}
