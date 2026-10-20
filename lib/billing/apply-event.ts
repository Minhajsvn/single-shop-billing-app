// SERVER ONLY: applies events with the service-role client.
import { createAdminClient } from "../supabase/admin.ts";
import type { BillingEvent } from "./stripe-events.ts";

export type ApplyResult = "applied" | "duplicate" | "stale" | "unknown_business";

const RESULTS: readonly ApplyResult[] = ["applied", "duplicate", "stale", "unknown_business"];

/** `permanent` errors are caused by the event itself (retrying cannot help); others are transient. */
export class BillingEventError extends Error {
  readonly permanent: boolean;
  constructor(message: string, permanent: boolean) {
    super(message);
    this.name = "BillingEventError";
    this.permanent = permanent;
  }
}

type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
};

// SQLSTATE class 22 (data exception: bad cast, invalid_billing_event) and 23 (integrity constraint)
// come from malformed input; everything else (network, auth, server) is worth a retry.
const isInputError = (code: string | undefined) => Boolean(code && /^2[23]/.test(code));

export async function applyBillingEvent(event: BillingEvent, client: RpcClient = createAdminClient()): Promise<ApplyResult> {
  const { data, error } = await client.rpc("apply_billing_event", { p_event: event });
  if (error) throw new BillingEventError(error.message, isInputError(error.code));
  if (typeof data !== "string" || !RESULTS.includes(data as ApplyResult)) {
    throw new BillingEventError(`Unexpected apply_billing_event result: ${String(data)}`, false);
  }
  return data as ApplyResult;
}

/** unknown_business is a non-2xx so Stripe redelivers it once checkout has linked the ids. */
export function webhookStatus(result: ApplyResult): number {
  return result === "unknown_business" ? 409 : 200;
}
