import { parsePinSet } from "@/lib/staff/actions";
import { MEMBER_ID, readJson, refuse, rpcFailure, staffSession } from "@/lib/staff/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ memberId: string }> };

/** Set a PIN: `{ pinHash, pinSalt }`, made on the device. The owner may set anyone's; a member only their own. */
export async function PUT(request: Request, { params }: Context) {
  const { memberId } = await params;
  if (!MEMBER_ID.test(memberId)) return refuse("member_not_found", 404);
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId } = auth.session;

  const parsed = parsePinSet(await readJson(request));
  if (!parsed.ok) return refuse(parsed.code);
  const { error } = await supabase.rpc("staff_set_pin", { p_business_id: businessId, p_member_id: memberId, p_pin_hash: parsed.pinHash, p_pin_salt: parsed.pinSalt });
  if (error) return rpcFailure("set_pin", error);
  return Response.json({ ok: true });
}

/** Reset a PIN (owner only): the person must set a new one before they can use the till. */
export async function DELETE(_request: Request, { params }: Context) {
  const { memberId } = await params;
  if (!MEMBER_ID.test(memberId)) return refuse("member_not_found", 404);
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId } = auth.session;
  const { error } = await supabase.rpc("staff_reset_pin", { p_business_id: businessId, p_member_id: memberId });
  if (error) return rpcFailure("reset_pin", error);
  return Response.json({ ok: true });
}
