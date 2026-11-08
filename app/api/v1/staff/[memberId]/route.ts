import { parseMemberUpdate } from "@/lib/staff/actions";
import { MEMBER_ID, readJson, refuse, rpcFailure, staffSession } from "@/lib/staff/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ memberId: string }> };

/** Change one staff member: `{ role }` (cashier | manager) or `{ status }` (active | disabled). Owner only. */
export async function PATCH(request: Request, { params }: Context) {
  const { memberId } = await params;
  if (!MEMBER_ID.test(memberId)) return refuse("member_not_found", 404);
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId } = auth.session;

  const parsed = parseMemberUpdate(await readJson(request));
  if (!parsed.ok) return refuse(parsed.code);

  const { error } = "role" in parsed.change
    ? await supabase.rpc("staff_set_role", { p_business_id: businessId, p_member_id: memberId, p_role: parsed.change.role })
    : await supabase.rpc("staff_set_status", { p_business_id: businessId, p_member_id: memberId, p_status: parsed.change.status });
  if (error) return rpcFailure("update", error);
  return Response.json({ ok: true });
}
