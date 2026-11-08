import { parseLockSettings } from "@/lib/staff/actions";
import { readJson, refuse, rpcFailure, staffSession } from "@/lib/staff/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** PIN lock settings: `{ pinLockEnabled, idleLockMinutes, managerDiscountPct }`. Owner only; the lock needs Pro and the owner's PIN. */
export async function PUT(request: Request) {
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId } = auth.session;

  const parsed = parseLockSettings(await readJson(request));
  if (!parsed.ok) return refuse(parsed.code);
  const { error } = await supabase.rpc("shop_set_lock_settings", {
    p_business_id: businessId, p_pin_lock_enabled: parsed.pinLockEnabled, p_idle_lock_minutes: parsed.idleLockMinutes, p_manager_discount_pct: parsed.managerDiscountPct,
  });
  if (error) return rpcFailure("lock_settings", error);
  return Response.json({ ok: true });
}
