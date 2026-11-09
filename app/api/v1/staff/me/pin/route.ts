import { parsePinSet } from "@/lib/staff/actions";
import { readJson, refuse, rpcFailure, staffSession } from "@/lib/staff/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Set your own PIN: `{ pinHash, pinSalt }`. Any active member, for their own row in their shop. */
export async function PUT(request: Request) {
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId, userId } = auth.session;

  const parsed = parsePinSet(await readJson(request));
  if (!parsed.ok) return refuse(parsed.code);
  const { data: me, error: meError } = await supabase.from("business_members").select("id").eq("business_id", businessId).eq("user_id", userId).maybeSingle();
  if (meError || !me) return refuse("member_not_found", 404);
  const { error } = await supabase.rpc("staff_set_pin", { p_business_id: businessId, p_member_id: me.id, p_pin_hash: parsed.pinHash, p_pin_salt: parsed.pinSalt });
  if (error) return rpcFailure("set_own_pin", error);
  return Response.json({ ok: true });
}
