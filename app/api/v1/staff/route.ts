import { parseInvite } from "@/lib/staff/actions";
import { inviteStaff, type InviteResult } from "@/lib/staff/invite";
import { readJson, refuse, rpcFailure, staffSession } from "@/lib/staff/route";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The owner's staff list for Settings → Staff (staff_list refuses anyone else). */
export async function GET() {
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId } = auth.session;
  const { data, error } = await supabase.rpc("staff_list", { p_business_id: businessId });
  if (error) return rpcFailure("list", error);
  // Settings needs whether a PIN is set, not the hash itself.
  const staff = ((data ?? []) as Record<string, unknown>[]).map((m) => ({
    memberId: m.member_id, displayName: m.display_name, email: m.email, role: m.role, status: m.status,
    pinSet: m.pin_hash != null, pinSetAt: m.pin_set_at, lastSaleAt: m.last_sale_at,
  }));
  return Response.json({ staff });
}

/** Invite: `{ email, displayName, role }`. A new email gets an invitation; an existing account is linked. */
export async function POST(request: Request) {
  const auth = await staffSession();
  if (!auth.ok) return auth.response;
  const { supabase, businessId, role } = auth.session;
  if (role !== "owner") return refuse("not_owner", 403);

  const parsed = parseInvite(await readJson(request));
  if (!parsed.ok) return refuse(parsed.code);

  const admin = createAdminClient();
  const redirectTo = `${new URL(request.url).origin}/auth/confirm?next=/reset-password`;
  const result = await inviteStaff(supabase, admin, { businessId, email: parsed.email, displayName: parsed.displayName, role: parsed.role }, {
    invite: async (email): Promise<InviteResult> => {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
      return error || !data.user ? { error: error?.message ?? "no user" } : { userId: data.user.id };
    },
  });
  if (!result.ok) return rpcFailure("invite", { code: "P0001", message: result.code });
  return Response.json({ ok: true, memberId: result.memberId, invited: result.invited });
}
